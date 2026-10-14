"""Daily per-account sending limits. "Today" is midnight-to-midnight in settings.TIME_ZONE."""
from django.db.models import Count
from django.utils import timezone

from apps.core.models import AppSettings


def start_of_today():
    return timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)


def sent_today_by_account() -> dict[int, int]:
    from .models import CampaignTarget

    rows = (
        CampaignTarget.objects.filter(status=CampaignTarget.Status.SENT, sent_at__gte=start_of_today(), account__isnull=False)
        .values("account")
        .annotate(n=Count("id"))
    )
    return {r["account"]: r["n"] for r in rows}


def sent_today(account_id: int) -> int:
    from .models import CampaignTarget

    return CampaignTarget.objects.filter(
        status=CampaignTarget.Status.SENT, sent_at__gte=start_of_today(), account_id=account_id
    ).count()


def limit_for(account) -> int:
    """0 = unlimited."""
    return account.daily_limit if account.daily_limit is not None else AppSettings.load().daily_limit
