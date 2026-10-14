from datetime import timedelta

import pytest
from django.utils import timezone

from apps.broadcasts import runner
from apps.broadcasts.models import Campaign, CampaignTarget
from apps.contacts import validation
from apps.contacts.models import Contact, ContactList

pytestmark = pytest.mark.django_db


def test_background_check_marks_numbers(provider, account, contacts):
    provider.not_on_whatsapp = {contacts[1].phone}
    assert validation.validate_pending(pause=0) == 3
    got = {c.phone: (c.on_whatsapp, c.wa_jid) for c in Contact.objects.all()}
    assert got[contacts[0].phone] == (True, f"{contacts[0].phone}@s.whatsapp.net")
    assert got[contacts[1].phone] == (False, "")
    assert validation.validate_pending(pause=0) == 0  # nothing left to check


def test_checks_in_batches_of_fifty(provider, account):
    Contact.objects.bulk_create([Contact(phone=f"8801800{i:06d}") for i in range(120)])
    assert validation.validate_pending(pause=0) == 120
    assert [len(p) for _, p in provider.checks] == [50, 50, 20]


def test_no_connected_account_waits(provider, account, contacts):
    account.status = "disconnected"
    account.save()
    assert validation.validate_pending(pause=0) == 0
    assert Contact.objects.filter(checked_at__isnull=True).count() == 3


def test_opted_out_are_not_checked(provider, account, contacts):
    Contact.objects.filter(pk=contacts[0].pk).update(opted_out=True)
    assert validation.validate_pending(pause=0) == 2


def test_import_reports_validation_and_summary_endpoint(client, provider, account):
    r = client.post("/api/contacts/import/", {"text": "01711111111\n01722222222", "new_list": "Promo"}, format="json").json()
    assert r["validation"] == {"total": 2, "valid": 0, "invalid": 0, "pending": 2, "opted_out": 0}
    provider.not_on_whatsapp = {"8801722222222"}
    validation.validate_pending(pause=0)
    lst = ContactList.objects.get(name="Promo")
    s = client.get(f"/api/contacts/validation/?list={lst.id}").json()
    assert s == {"total": 2, "valid": 1, "invalid": 1, "pending": 0, "opted_out": 0}
    assert client.get("/api/contacts/?valid=no").json()["results"][0]["phone"] == "8801722222222"
    assert client.get("/api/contact-lists/").json()[0]["contact_count"] == 1  # invalid numbers don't count


def test_recheck_queues_again(client, provider, account, contacts):
    validation.validate_pending(pause=0)
    client.post("/api/contacts/bulk/", {"action": "recheck", "ids": [contacts[0].id]}, format="json")
    assert list(validation.pending().values_list("id", flat=True)) == [contacts[0].id]


def test_runner_uses_fresh_results_without_asking_again(provider, account, contacts):
    validation.validate_pending(pause=0)
    provider.checks.clear()
    Contact.objects.filter(pk=contacts[2].pk).update(checked_at=timezone.now() - timedelta(days=60))  # stale
    c = Campaign.objects.create(message="x", delay_min_seconds=0, delay_max_seconds=0, batch_size=0)
    c.sender_accounts.set([account])
    for i, ct in enumerate(contacts):
        CampaignTarget.objects.create(campaign=c, contact=ct, recipient_jid=f"{ct.phone}@s.whatsapp.net", position=i)
    runner.claim_next()
    runner.run_campaign(c.pk)
    assert len(provider.sent) == 3
    assert provider.checks == [(account.session_id, [contacts[2].phone])]  # only the stale one was asked again
