"""Keeps WhatsAppAccount rows in step with the provider."""
import logging

from django.utils import timezone

from .models import WhatsAppAccount
from .providers import ProviderError, SessionState, get_provider

log = logging.getLogger(__name__)


def apply_state(account: WhatsAppAccount, state: SessionState) -> WhatsAppAccount:
    """Persist what the provider says about this account. Returns the account."""
    was_connected = account.is_connected
    fields = {"status": state.status, "last_error": (state.error or "")[:300]}
    if state.status == WhatsAppAccount.Status.CONNECTED:
        if state.phone:
            fields["phone"] = state.phone
        if state.name:
            fields["display_name"] = state.name[:120]
        if not was_connected:
            fields["connected_at"] = timezone.now()
    changed = [k for k, v in fields.items() if getattr(account, k) != v]
    for k in changed:
        setattr(account, k, fields[k])
    if changed:
        account.save(update_fields=[*changed, "updated_at"])
    return account


def refresh_all(accounts) -> tuple[dict[int, SessionState], bool]:
    """Ask the provider for live state (incl. QR codes). Returns ({account_id: state}, provider_online)."""
    accounts = list(accounts)
    if not accounts:
        return {}, get_provider().ping()
    try:
        states = get_provider().list_sessions([a.session_id for a in accounts])
    except ProviderError:
        return {}, False
    out = {}
    for a in accounts:
        st = states.get(a.session_id)
        if st:
            apply_state(a, st)
            out[a.id] = st
    return out, True


def handle_webhook(payload: dict) -> int:
    handled = 0
    for ev in get_provider().parse_webhook(payload):
        account = WhatsAppAccount.objects.filter(session_id=ev.session_id).first()
        if account and ev.state:
            apply_state(account, ev.state)
            handled += 1
    return handled
