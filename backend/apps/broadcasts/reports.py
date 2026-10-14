"""Delivery reports over a date range, as JSON for the Reports page or as a CSV download."""
from datetime import date, datetime, time, timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.core.csvutil import csv_response

from .models import CampaignTarget

T = CampaignTarget.Status
MAX_DAYS = 366


def date_range(params):
    """[start, end) in local time from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive). Default: last 30 days."""
    today = timezone.localdate()
    try:
        d_to = date.fromisoformat(params.get("to")) if params.get("to") else today
        d_from = date.fromisoformat(params.get("from")) if params.get("from") else d_to - timedelta(days=29)
    except ValueError:
        raise ValueError("Dates must look like 2026-01-31.")
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    if (d_to - d_from).days >= MAX_DAYS:
        raise ValueError(f"Pick a range of at most {MAX_DAYS} days.")
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(d_from, time.min), tz)
    end = timezone.make_aware(datetime.combine(d_to + timedelta(days=1), time.min), tz)
    return d_from, d_to, start, end


def finished_targets(start, end):
    return CampaignTarget.objects.filter(finished_at__gte=start, finished_at__lt=end)


COUNTS = {
    "sent": Count("id", filter=Q(status=T.SENT)),
    "failed": Count("id", filter=Q(status=T.FAILED)),
    "skipped": Count("id", filter=Q(status=T.SKIPPED)),
}


@api_view(["GET"])
def summary(request):
    try:
        d_from, d_to, start, end = date_range(request.query_params)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    qs = finished_targets(start, end)
    totals = qs.aggregate(**COUNTS)

    by_day = {
        r["day"].isoformat(): r
        for r in qs.annotate(day=TruncDate("finished_at", tzinfo=timezone.get_current_timezone()))
        .values("day").annotate(**COUNTS)
    }
    days = []
    d = d_from
    while d <= d_to:
        r = by_day.get(d.isoformat(), {})
        days.append({"date": d.isoformat(), "sent": r.get("sent", 0), "failed": r.get("failed", 0), "skipped": r.get("skipped", 0)})
        d += timedelta(days=1)

    per_account = list(qs.values("account_id", "account_label").annotate(**COUNTS).order_by("-sent", "account_label"))
    per_campaign = list(
        qs.values("campaign_id", "campaign__name", "campaign__status").annotate(**COUNTS).order_by("-campaign_id")[:100]
    )
    errors = list(
        qs.filter(status__in=[T.FAILED, T.SKIPPED]).exclude(error="")
        .values("error").annotate(count=Count("id")).order_by("-count")[:10]
    )
    return Response({
        "from": d_from.isoformat(), "to": d_to.isoformat(),
        "totals": totals,
        "days": days,
        "accounts": [{"account_id": r["account_id"], "label": r["account_label"], "sent": r["sent"], "failed": r["failed"],
                      "skipped": r["skipped"]} for r in per_account],
        "campaigns": [{"id": r["campaign_id"], "name": r["campaign__name"], "status": r["campaign__status"], "sent": r["sent"],
                       "failed": r["failed"], "skipped": r["skipped"]} for r in per_campaign],
        "top_errors": errors,
    })


TARGET_HEADER = ["Finished", "Campaign", "Campaign ID", "Sent from", "Name", "Number", "Status", "Error"]


def target_rows(qs):
    for t in qs.select_related("campaign").order_by("finished_at", "id").iterator(chunk_size=2000):
        yield [t.finished_at, t.campaign.name, t.campaign_id, t.account_label, t.recipient_name,
               "+" + t.recipient_jid.split("@")[0], t.get_status_display(), t.error]


@api_view(["GET"])
def export(request):
    try:
        d_from, d_to, start, end = date_range(request.query_params)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return csv_response(f"delivery-report_{d_from}_to_{d_to}.csv", TARGET_HEADER, target_rows(finished_targets(start, end)))
