from datetime import timedelta

import pytest
from django.utils import timezone

from apps.broadcasts import runner
from apps.broadcasts.models import Campaign, CampaignTarget
from apps.core.models import AppSettings
from tests.helpers import me

pytestmark = pytest.mark.django_db
S, T = Campaign.Status, CampaignTarget.Status


def make_campaign(senders, contacts, message="Hello *all*", **kw):
    c = Campaign.objects.create(owner=me(), message=message, delay_min_seconds=0, delay_max_seconds=0, batch_size=0, **kw)
    c.sender_accounts.set(senders)
    for i, ct in enumerate(contacts):
        CampaignTarget.objects.create(campaign=c, contact=ct, recipient_jid=f"{ct.phone}@s.whatsapp.net",
                                      recipient_name=ct.name, position=i)
    return c


def sent_to(provider):
    return [to.split("@")[0] for _, to, _, _ in provider.sent]


def test_sends_to_every_number_in_order(provider, account, contacts):
    c = make_campaign([account], contacts)
    assert runner.claim_next().pk == c.pk
    assert runner.run_campaign(c.pk) == S.COMPLETED
    assert sent_to(provider) == [ct.phone for ct in contacts]
    assert set(c.targets.values_list("status", flat=True)) == {T.SENT}
    assert set(c.targets.values_list("account_label", flat=True)) == {"Office"}


def test_one_failure_does_not_stop_the_send(provider, account, contacts):
    provider.fail_for = {f"{contacts[1].phone}@s.whatsapp.net"}
    c = make_campaign([account], contacts)
    runner.claim_next()
    runner.run_campaign(c.pk)
    st = list(c.targets.order_by("position").values_list("status", flat=True))
    assert st == [T.SENT, T.FAILED, T.SENT]
    assert c.targets.get(position=1).error == "Message rejected"


def test_daily_limit_skips_extra_messages(provider, account, contacts):
    s = AppSettings.load(me())
    s.daily_limit = 2
    s.save()
    c = make_campaign([account], contacts)
    runner.claim_next()
    runner.run_campaign(c.pk)
    assert len(provider.sent) == 2
    last = c.targets.get(position=2)
    assert last.status == T.SKIPPED and "Daily limit" in last.error


def test_per_account_limit_overrides_workspace(provider, account, contacts):
    account.daily_limit = 1
    account.save()
    c = make_campaign([account], contacts[:2])
    runner.claim_next()
    runner.run_campaign(c.pk)
    assert len(provider.sent) == 1


def test_future_campaign_is_not_claimed(provider, account, contacts):
    make_campaign([account], contacts, scheduled_at=timezone.now() + timedelta(hours=1))
    assert runner.claim_next() is None


def test_only_one_campaign_runs_at_a_time(provider, account, contacts):
    make_campaign([account], contacts[:1])
    make_campaign([account], contacts[1:2])
    assert runner.claim_next() is not None
    assert runner.claim_next() is None


def test_cancel_during_wait_stops_the_send(provider, account, contacts, monkeypatch):
    c = make_campaign([account], contacts[:2])
    c.delay_min_seconds = c.delay_max_seconds = 30
    c.save()
    real_wait = runner._wait

    def cancel_then_wait(campaign, seconds, note):
        Campaign.objects.filter(pk=campaign.pk).update(status=S.CANCELLED)
        return real_wait(campaign, seconds, note)

    monkeypatch.setattr(runner, "_wait", cancel_then_wait)
    runner.claim_next()
    assert runner.run_campaign(c.pk) == S.CANCELLED
    assert len(provider.sent) == 1


def test_disconnected_account_fails_fast(provider, account, contacts):
    account.status = "disconnected"
    account.save()
    c = make_campaign([account], contacts[:1])
    runner.claim_next()
    runner.run_campaign(c.pk)
    assert provider.sent == []
    assert c.targets.get().status == T.FAILED


def test_interrupted_campaign_resumes_without_resending(provider, account, contacts):
    c = make_campaign([account], contacts)
    c.targets.filter(position=0).update(status=T.SENT, sent_at=timezone.now())
    c.targets.filter(position=1).update(status=T.SENDING)
    Campaign.objects.filter(pk=c.pk).update(status=S.RUNNING, heartbeat_at=timezone.now() - timedelta(minutes=10))

    claimed = runner.claim_next()
    assert claimed.pk == c.pk
    runner.run_campaign(c.pk)
    assert sent_to(provider) == [contacts[2].phone]  # first already sent, second ambiguous -> failed, not resent
    assert c.targets.get(position=1).status == T.FAILED
