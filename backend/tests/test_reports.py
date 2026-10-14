import csv
import io
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.broadcasts.models import Campaign, CampaignTarget
from apps.contacts.models import Contact, ContactList

pytestmark = pytest.mark.django_db


def read_csv(resp):
    text = b"".join(resp.streaming_content).decode() if resp.streaming else resp.content.decode()
    assert text.startswith("\ufeff")
    return list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))


@pytest.fixture
def history(account):
    c = Campaign.objects.create(name="Eid offer", message="x", status="completed")
    now = timezone.now()
    rows = [
        ("8801700000009@s.whatsapp.net", "Alpha", "sent", ""),
        ("8801700000001@s.whatsapp.net", "Rahim", "sent", ""),
        ("8801700000002@s.whatsapp.net", "=HYPERLINK()", "failed", "+8801700000002 is not on WhatsApp."),
        ("8801700000003@s.whatsapp.net", "", "skipped", "This contact opted out."),
    ]
    for i, (jid, name, st, err) in enumerate(rows):
        CampaignTarget.objects.create(campaign=c, account=account, account_label=account.label, recipient_jid=jid,
                                      recipient_name=name, status=st, error=err, position=i, finished_at=now,
                                      sent_at=now if st == "sent" else None)
    # outside the default 30-day window
    CampaignTarget.objects.create(campaign=c, account=account, account_label=account.label, recipient_jid="8801700000099@s.whatsapp.net",
                                  status="sent", position=9, finished_at=now - timedelta(days=60))
    return c


def test_report_summary(client, history):
    r = client.get("/api/reports/").json()
    assert r["totals"] == {"sent": 2, "failed": 1, "skipped": 1}
    assert len(r["days"]) == 30 and r["days"][-1]["sent"] == 2
    assert r["accounts"][0]["label"] == "Office" and r["campaigns"][0]["name"] == "Eid offer"
    assert {e["error"] for e in r["top_errors"]} == {"+8801700000002 is not on WhatsApp.", "This contact opted out."}


def test_report_bad_dates(client):
    assert client.get("/api/reports/?from=yesterday").status_code == 400
    assert client.get("/api/reports/?from=2020-01-01&to=2026-01-01").status_code == 400


def test_report_and_campaign_csv(client, history):
    rows = read_csv(client.get("/api/reports/export/"))
    assert rows[0][0] == "Finished" and len(rows) == 5
    rahim = next(r for r in rows if r[4] == "Rahim")
    assert rahim[5] == "+8801700000001" and rahim[6] == "Sent"
    assert any(r[4] == "'=HYPERLINK()" for r in rows)  # formula injection neutralised
    assert len(read_csv(client.get(f"/api/campaigns/{history.pk}/export/"))) == 6  # header + all 5, any date


def test_contacts_export_round_trips_through_import(client):
    lst = ContactList.objects.create(name="VIP")
    Contact.objects.create(phone="8801700000001", name="Rahim").lists.add(lst)
    Contact.objects.create(phone="8801700000002", name="Karim", opted_out=True)
    rows = read_csv(client.get(f"/api/contacts/export/?list={lst.id}"))
    assert rows == [["Name", "Phone", "Lists", "Opted out", "On WhatsApp", "Checked"],
                    ["Rahim", "+8801700000001", "VIP", "", "not checked yet", ""]]

    Contact.objects.all().delete()
    text = "\n".join(",".join(r) for r in rows)
    r = client.post("/api/contacts/import/", {"text": text}, format="json").json()
    assert r["created"] == 1 and Contact.objects.get().phone == "8801700000001"
