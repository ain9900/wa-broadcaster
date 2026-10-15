"""The sending engine.

Each workspace sends one campaign at a time (like a person working through a list), so its accounts
are never hammered by two sends at once. Different workspaces send side by side. All progress lives in the database, which means a crash or restart
resumes where it stopped instead of losing the send. Celery (tasks.py) and the no-Docker
`manage.py run_worker` loop both drive the same two functions: claim_next() and run_campaign().
"""
import logging
import random
import re
import time
from datetime import timedelta

from django.core.cache import cache
from django.db import close_old_connections, transaction
from django.utils import timezone

from apps.core.models import AppSettings, Rotation
from apps.whatsapp.models import WhatsAppAccount
from apps.whatsapp.providers import Media, ProviderError, get_provider

from .limits import limit_for, sent_today
from .models import Campaign, CampaignTarget

log = logging.getLogger(__name__)

STALE_AFTER = timedelta(minutes=5)  # a running campaign without a heartbeat this long is orphaned
HEARTBEAT_EVERY = 10  # seconds
POLL_EVERY = 1  # seconds, how fast pause/cancel is noticed while waiting
S = Campaign.Status
T = CampaignTarget.Status


def recover_stale(force: bool = False) -> int:
    """Put campaigns whose worker died back in the queue. Returns how many.

    force=True re-queues every running campaign; call it only when this is the sole worker and it
    has just started (so nothing can genuinely be running).
    """
    running = Campaign.objects.filter(status=S.RUNNING)
    if not force:
        running = running.filter(heartbeat_at__lt=timezone.now() - STALE_AFTER)
    n = 0
    for c in running:
        with transaction.atomic():
            # A target caught mid-send may or may not have arrived; don't risk a duplicate.
            c.targets.filter(status=T.SENDING).update(
                status=T.FAILED, error="Interrupted while sending; it may or may not have arrived.", finished_at=timezone.now()
            )
            n += Campaign.objects.filter(pk=c.pk, status=S.RUNNING).update(
                status=S.SCHEDULED, note="Resumed after an interruption", next_action_at=None
            )
    if n:
        log.warning("re-queued %s interrupted campaign(s)", n)
    return n


def claim_next() -> Campaign | None:
    """Atomically move the next due campaign to RUNNING. None if nothing is due.
    A workspace that already has a campaign running waits until it finishes."""
    if not cache.add("broadcasts:claim-lock", 1, timeout=30):
        return None
    try:
        recover_stale()
        now = timezone.now()
        busy = Campaign.objects.filter(status=S.RUNNING).values("owner_id")
        nxt = (Campaign.objects.filter(status=S.SCHEDULED, scheduled_at__lte=now).exclude(owner_id__in=busy)
               .order_by("scheduled_at", "id").first())
        if not nxt:
            return None
        claimed = Campaign.objects.filter(pk=nxt.pk, status=S.SCHEDULED).update(status=S.RUNNING, heartbeat_at=now)
        return Campaign.objects.get(pk=nxt.pk) if claimed else None
    finally:
        cache.delete("broadcasts:claim-lock")


def _status(campaign_id) -> str:
    return Campaign.objects.filter(pk=campaign_id).values_list("status", flat=True).first()


def _wait(campaign: Campaign, seconds: float, note: str) -> bool:
    """Sleep, waking early on pause/cancel. Returns True if the campaign is still running."""
    end = time.monotonic() + seconds
    Campaign.objects.filter(pk=campaign.pk).update(
        next_action_at=timezone.now() + timedelta(seconds=seconds), note=note, heartbeat_at=timezone.now()
    )
    last_beat = time.monotonic()
    still_running = True
    while time.monotonic() < end:
        time.sleep(min(POLL_EVERY, max(0, end - time.monotonic())))
        if _status(campaign.pk) != S.RUNNING:
            still_running = False
            break
        if time.monotonic() - last_beat >= HEARTBEAT_EVERY:
            Campaign.objects.filter(pk=campaign.pk).update(heartbeat_at=timezone.now())
            last_beat = time.monotonic()
    Campaign.objects.filter(pk=campaign.pk).update(next_action_at=None, note="")
    return still_running


def _finish(target: CampaignTarget, status: str, error: str = ""):
    now = timezone.now()
    target.status, target.error, target.finished_at = status, error[:300], now
    if status == T.SENT:
        target.sent_at = now
    target.save(update_fields=["status", "error", "finished_at", "sent_at"])


def _load_media(campaign: Campaign) -> Media | None:
    if not campaign.media_id:
        return None
    m = campaign.media
    with m.file.open("rb") as fh:
        return Media(data=fh.read(), mimetype=m.mime_type, filename=m.original_name)


NAME_TAG = re.compile(r"\{name(?:\|([^}]*))?\}", re.IGNORECASE)


def personalize(message: str, name: str) -> str:
    """Fill {name} with the recipient's name; {name|friend} falls back to "friend" when there is none."""
    return NAME_TAG.sub(lambda m: name or (m.group(1) or "").strip(), message or "")


def _resolve_contact(provider, account, target: CampaignTarget) -> tuple[str | None, str | None, str]:
    """(chat id to send to, None, "") or (None, status, reason) if this number must not be sent to.

    Uses the stored validation result when it is fresh; otherwise asks WhatsApp now and stores the answer.
    """
    from apps.contacts.validation import is_fresh, record_results

    phone = target.recipient_jid.split("@")[0]
    contact = target.contact
    if contact is not None:
        contact.refresh_from_db(fields=["opted_out", "on_whatsapp", "wa_jid", "checked_at"])
        if contact.opted_out:
            return None, T.SKIPPED, "This contact opted out."
        if is_fresh(contact):
            if contact.on_whatsapp is False:
                return None, T.FAILED, f"+{phone} is not on WhatsApp."
            return contact.wa_jid or target.recipient_jid, None, ""
    resolved = provider.check_number(account.session_id, phone)  # may raise ProviderError
    record_results({phone: resolved}, owner=account.owner_id)
    if not resolved:
        return None, T.FAILED, f"+{phone} is not on WhatsApp."
    return resolved, None, ""


def _usable(account) -> tuple[bool, str, str]:
    """Can this account send right now? (ok, status if not, reason if not)"""
    if account.status != WhatsAppAccount.Status.CONNECTED:
        return False, T.FAILED, f"{account.label} is not connected."
    limit = limit_for(account)
    if limit and sent_today(account.id) >= limit:
        return False, T.SKIPPED, f"Daily limit of {limit} reached for {account.label}."
    return True, "", ""


def pick_sender(campaign: Campaign):
    """Choose the account that sends the next message, following the campaign's rotation.

    Returns (account, "", "") or (None, status, reason) when no account can send it.
    Take turns: the current account sends `rotate_every` messages, then the next one takes over.
    Random: any sender. Balanced: the sender with the fewest messages today.
    With failover, an account that is disconnected or at its daily limit is passed over.
    """
    senders = list(campaign.sender_accounts.order_by("id"))
    if not senders:
        return None, T.FAILED, "No accounts were chosen to send from."

    mode = campaign.rotation_mode
    if mode == Rotation.RANDOM:
        order = random.sample(senders, len(senders))
    elif mode == Rotation.BALANCED:
        order = sorted(senders, key=lambda a: (sent_today(a.id), a.id))
    else:
        ids = [a.id for a in senders]
        cur = ids.index(campaign.rotation_account_id) if campaign.rotation_account_id in ids else 0
        if campaign.rotation_account_id in ids and campaign.rotation_used >= campaign.rotate_every:
            cur = (cur + 1) % len(ids)  # this account's turn is over
        order = senders[cur:] + senders[:cur]
    if not campaign.failover:
        order = order[:1]

    problems = []
    for account in order:
        ok, status, reason = _usable(account)
        if ok:
            if mode == Rotation.TURNS:
                used = campaign.rotation_used + 1 if account.id == campaign.rotation_account_id else 1
                Campaign.objects.filter(pk=campaign.pk).update(rotation_account=account, rotation_used=used)
                campaign.rotation_account_id, campaign.rotation_used = account.id, used
            return account, "", ""
        problems.append((status, reason))
        if mode == Rotation.TURNS and not campaign.failover:
            Campaign.objects.filter(pk=campaign.pk).update(rotation_account=account, rotation_used=campaign.rotate_every)
            campaign.rotation_account_id, campaign.rotation_used = account.id, campaign.rotate_every
    if len(problems) > 1:
        # Every sender was tried. Skipped (limits) only if none of them simply failed.
        status = T.SKIPPED if all(st == T.SKIPPED for st, _ in problems) else T.FAILED
        return None, status, "No sender account could send: " + " ".join(r for _, r in problems)
    return None, problems[0][0], problems[0][1]


def run_campaign(campaign_id: int) -> str | None:
    """Send every pending target of a RUNNING campaign. Returns the final status."""
    close_old_connections()
    campaign = Campaign.objects.select_related("media").filter(pk=campaign_id).first()
    if not campaign or campaign.status != S.RUNNING:
        return campaign.status if campaign else None

    Campaign.objects.filter(pk=campaign.pk, started_at__isnull=True).update(started_at=timezone.now())
    provider = get_provider()
    typing = campaign.typing_indicator and AppSettings.load(campaign.owner).typing_indicator
    try:
        media = _load_media(campaign)
    except OSError:
        campaign.targets.filter(status=T.PENDING).update(status=T.FAILED, error="The attached file is missing on the server.")
        media = None

    sent_in_batch = 0
    while _status(campaign.pk) == S.RUNNING:
        target = campaign.targets.filter(status=T.PENDING).select_related("account", "contact").order_by("position", "id").first()
        if not target:
            break
        # The sender is chosen now, so rotation and failover see each account's live state.
        account, status, reason = pick_sender(campaign)
        if account is None:
            _finish(target, status, reason)
            continue
        target.account, target.account_label = account, account.label
        target.save(update_fields=["account", "account_label"])

        try:
            to, skip_status, reason = _resolve_contact(provider, account, target)
        except ProviderError as e:
            to, skip_status, reason = None, T.FAILED, str(e)
        if not to:
            _finish(target, skip_status, reason)
            continue

        target.status, target.attempts = T.SENDING, target.attempts + 1
        target.save(update_fields=["status", "attempts"])
        label = (target.recipient_name or target.recipient_jid.split("@")[0])[:150]
        Campaign.objects.filter(pk=campaign.pk).update(heartbeat_at=timezone.now(), note=f"Sending to {label}")
        text = personalize(campaign.message, target.recipient_name)
        try:
            provider.send_message(account.session_id, to, text, media=media, typing=typing)
        except ProviderError as e:
            _finish(target, T.FAILED, str(e))
        except Exception as e:  # never let one bad recipient kill the whole send
            log.exception("send to %s failed", to)
            _finish(target, T.FAILED, f"Unexpected error: {e}")
        else:
            _finish(target, T.SENT)
            sent_in_batch += 1

        if not campaign.targets.filter(status=T.PENDING).exists():
            break
        if campaign.batch_size and sent_in_batch >= campaign.batch_size:
            sent_in_batch = 0
            ok = _wait(campaign, campaign.batch_pause_minutes * 60, f"Break after {campaign.batch_size} messages")
        else:
            lo, hi = sorted((campaign.delay_min_seconds, campaign.delay_max_seconds))
            ok = _wait(campaign, random.uniform(lo, hi), "Pause before the next message")
        if not ok:
            break

    Campaign.objects.filter(pk=campaign.pk, status=S.RUNNING).update(
        status=S.COMPLETED, finished_at=timezone.now(), next_action_at=None, note=""
    )
    final = _status(campaign.pk)
    log.info("campaign %s finished with status %s", campaign.pk, final)
    return final


def cleanup_unused_media(older_than=timedelta(days=1)) -> int:
    """Delete uploads that no campaign uses (e.g. attached and then removed from the composer).
    Files with a public link are kept: the link may be in messages people already received."""
    from .models import MediaFile

    n = 0
    stale = MediaFile.objects.filter(created_at__lt=timezone.now() - older_than, campaigns__isnull=True, public_token__isnull=True)
    for m in stale:
        m.file.delete(save=False)
        m.delete()
        n += 1
    return n
