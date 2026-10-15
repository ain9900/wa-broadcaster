"""Checking which saved numbers are on WhatsApp.

Imported numbers start unchecked (checked_at is empty). A background job (Celery beat, or the
built-in worker) checks them in batches through a connected account and stores the result, so
campaigns can leave out numbers that aren't on WhatsApp before sending anything.
"""
import logging
import time
from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone

from apps.whatsapp.models import WhatsAppAccount
from apps.whatsapp.providers import ProviderError, get_provider

from .models import Contact

log = logging.getLogger(__name__)

FRESH_FOR = timedelta(days=30)  # results older than this are checked again before sending
PAUSE_BETWEEN_BATCHES = 3  # seconds; keeps the lookups gentle on the account


def is_fresh(contact) -> bool:
    return bool(contact.checked_at and contact.on_whatsapp is not None and timezone.now() - contact.checked_at < FRESH_FOR)


def record_results(results: dict[str, str | None], owner) -> None:
    """Store {phone: chat id or None} answers from WhatsApp on one workspace's contacts (owner: user or id)."""
    now = timezone.now()
    for phone, jid in results.items():
        Contact.objects.filter(owner=owner, phone=phone).update(on_whatsapp=bool(jid), wa_jid=jid or "", checked_at=now)


def checker_account(owner):
    """One of this workspace's connected accounts to run lookups with (the one that has sent least today)."""
    from apps.broadcasts.limits import sent_today_by_account

    accounts = list(WhatsAppAccount.objects.filter(owner=owner, status=WhatsAppAccount.Status.CONNECTED))
    if not accounts:
        return None
    sent = sent_today_by_account()
    return min(accounts, key=lambda a: (sent.get(a.id, 0), a.id))


def pending(owner=None):
    qs = Contact.objects.filter(checked_at__isnull=True, opted_out=False)
    return qs if owner is None else qs.filter(owner=owner)


def validate_pending(max_batches: int = 10, pause: float = PAUSE_BETWEEN_BATCHES) -> int:
    """Check up to max_batches × 50 unchecked numbers per workspace, each workspace through its own
    connected accounts. Returns how many were checked.
    Safe to call often: a lock makes sure only one checker runs at a time."""
    if not cache.add("contacts:validate-lock", 1, timeout=600):
        return 0
    checked = 0
    try:
        provider = get_provider()
        owners = (WhatsAppAccount.objects.filter(status=WhatsAppAccount.Status.CONNECTED)
                  .filter(owner_id__in=pending().values("owner_id")).values_list("owner_id", flat=True).distinct())
        batches = 0
        for owner in list(owners):
            for _ in range(max_batches):
                account = checker_account(owner)
                if account is None:
                    break
                phones = list(pending(owner).order_by("id").values_list("phone", flat=True)[: provider.CHECK_BATCH])
                if not phones:
                    break
                if batches:
                    time.sleep(pause)
                batches += 1
                try:
                    record_results(provider.check_numbers(account.session_id, phones), owner=owner)
                except ProviderError as e:
                    log.warning("number check failed: %s", e)
                    break
                checked += len(phones)
    finally:
        cache.delete("contacts:validate-lock")
    return checked


def summary(qs=None) -> dict:
    qs = Contact.objects.all() if qs is None else qs
    return qs.aggregate(
        total=Count("id"),
        valid=Count("id", filter=Q(on_whatsapp=True)),
        invalid=Count("id", filter=Q(on_whatsapp=False)),
        pending=Count("id", filter=Q(checked_at__isnull=True, opted_out=False)),
        opted_out=Count("id", filter=Q(opted_out=True)),
    )
