import pytest

from apps.broadcasts import runner
from apps.broadcasts.models import Campaign, CampaignTarget
from apps.contacts.models import Contact
from apps.whatsapp.models import WhatsAppAccount

pytestmark = pytest.mark.django_db
T = CampaignTarget.Status


@pytest.fixture
def senders(account):
    b = WhatsAppAccount.objects.create(label="Shop", provider="fake", status="connected", phone="8801999999991")
    c = WhatsAppAccount.objects.create(label="Home", provider="fake", status="connected", phone="8801999999992")
    return [account, b, c]


def contact_campaign(senders, n, **kw):
    c = Campaign.objects.create(message="Hi {name}", delay_min_seconds=0, delay_max_seconds=0, batch_size=0, **kw)
    c.sender_accounts.set(senders)
    for i in range(n):
        ct = Contact.objects.create(phone=f"88017000001{i:02d}", name=f"C{i}")
        CampaignTarget.objects.create(campaign=c, contact=ct, account=None, account_label="",
                                      recipient_jid=f"{ct.phone}@s.whatsapp.net", recipient_name=ct.name, position=i)
    return c


def senders_used(provider, accounts):
    by_sid = {a.session_id: a.label for a in accounts}
    return [by_sid[sid] for sid, *_ in provider.sent]


def run(c):
    runner.claim_next()
    return runner.run_campaign(c.pk)


def test_take_turns_one_each(provider, senders):
    c = contact_campaign(senders, 5, rotation_mode="turns", rotate_every=1)
    run(c)
    assert senders_used(provider, senders) == ["Office", "Shop", "Home", "Office", "Shop"]


def test_take_turns_three_in_a_row(provider, senders):
    c = contact_campaign(senders, 7, rotation_mode="turns", rotate_every=3)
    run(c)
    assert senders_used(provider, senders) == ["Office"] * 3 + ["Shop"] * 3 + ["Home"]
    assert set(c.targets.values_list("account_label", flat=True)) == {"Office", "Shop", "Home"}


def test_failover_passes_over_a_disconnected_account(provider, senders):
    senders[1].status = "disconnected"
    senders[1].save()
    c = contact_campaign(senders, 4, rotation_mode="turns", rotate_every=1, failover=True)
    run(c)
    assert senders_used(provider, senders) == ["Office", "Home", "Office", "Home"]
    assert set(c.targets.values_list("status", flat=True)) == {T.SENT}


def test_without_failover_the_message_fails(provider, senders):
    senders[1].status = "disconnected"
    senders[1].save()
    c = contact_campaign(senders, 3, rotation_mode="turns", rotate_every=1, failover=False)
    run(c)
    assert senders_used(provider, senders) == ["Office", "Home"]
    failed = c.targets.get(status=T.FAILED)
    assert "Shop is not connected" in failed.error


def test_failover_on_daily_limit(provider, senders):
    for a in senders:
        a.daily_limit = 1
        a.save()
    c = contact_campaign(senders, 4, rotation_mode="turns", rotate_every=5, failover=True)
    run(c)
    assert senders_used(provider, senders) == ["Office", "Shop", "Home"]  # each hits its limit, the next takes over
    last = c.targets.get(position=3)
    assert last.status == T.SKIPPED and "No sender account could send" in last.error


def test_balanced_spreads_evenly(provider, senders):
    c = contact_campaign(senders, 6, rotation_mode="balanced")
    run(c)
    used = senders_used(provider, senders)
    assert sorted(used.count(x) for x in ("Office", "Shop", "Home")) == [2, 2, 2]


def test_random_only_uses_chosen_senders(provider, senders):
    c = contact_campaign(senders[:2], 6, rotation_mode="random")
    run(c)
    assert set(senders_used(provider, senders)) <= {"Office", "Shop"}


def test_rotation_resumes_after_restart(provider, senders):
    c = contact_campaign(senders, 4, rotation_mode="turns", rotate_every=2)
    Campaign.objects.filter(pk=c.pk).update(rotation_account=senders[0], rotation_used=1)  # Office already sent 1
    run(c)
    assert senders_used(provider, senders) == ["Office", "Shop", "Shop", "Home"]


def test_create_stores_rotation_and_defers_sender(client, provider, senders):
    ct = Contact.objects.create(phone="8801700000001")
    r = client.post("/api/campaigns/", {
        "message": "x", "contact_ids": [ct.id], "sender_account_ids": [a.id for a in senders],
        "rotation_mode": "turns", "rotate_every": 3, "failover": False,
    }, format="json").json()
    assert r["rotation_mode"] == "turns" and r["rotate_every"] == 3 and r["failover"] is False
    assert sorted(r["sender_account_ids"]) == sorted(a.id for a in senders)
    assert r["targets"][0]["account_id"] is None  # chosen at send time
