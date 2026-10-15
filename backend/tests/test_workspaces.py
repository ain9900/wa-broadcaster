"""Each user works in their own workspace; team members work in their owner's."""
import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.broadcasts import runner
from apps.broadcasts.models import Campaign, CampaignTarget, MediaFile, MessageTemplate
from apps.contacts import validation
from apps.contacts.models import Contact, ContactList
from apps.core.models import AppSettings, TeamMember
from apps.whatsapp.models import WhatsAppAccount

pytestmark = pytest.mark.django_db
User = get_user_model()
PW = "a-long-test-password"


def signed_in(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def alice(db):
    return User.objects.create_user("alice", password=PW)


@pytest.fixture
def bob(db):
    return User.objects.create_user("bob", password=PW)


@pytest.fixture
def alice_data(alice):
    acc = WhatsAppAccount.objects.create(owner=alice, label="Alice phone", provider="fake", status="connected", phone="8801000000001")
    lst = ContactList.objects.create(owner=alice, name="VIP")
    contact = Contact.objects.create(owner=alice, phone="8801700000001", name="Rahim")
    contact.lists.add(lst)
    tpl = MessageTemplate.objects.create(owner=alice, title="Eid", body="Eid Mubarak")
    media = MediaFile.objects.create(owner=alice, file="uploads/x.jpg", original_name="x.jpg", mime_type="image/jpeg", size=1)
    camp = Campaign.objects.create(owner=alice, name="Alice offer", message="Hi")
    CampaignTarget.objects.create(campaign=camp, contact=contact, recipient_jid="8801700000001@s.whatsapp.net",
                                  account=acc, account_label=acc.label, status="sent")
    return {"account": acc, "list": lst, "contact": contact, "template": tpl, "media": media, "campaign": camp}


# ---------- isolation ----------

def test_other_workspace_sees_nothing(bob, alice_data):
    c = signed_in(bob)
    assert c.get("/api/accounts/").json()["results"] == []
    assert c.get("/api/contacts/").json()["count"] == 0
    assert c.get("/api/contact-lists/").json() == []
    assert c.get("/api/templates/").json() == []
    assert c.get("/api/campaigns/").json()["count"] == 0
    assert c.get("/api/reports/").json()["totals"]["sent"] == 0
    assert c.get("/api/dashboard/").json()["accounts"]["total"] == 0
    assert c.get("/api/contacts/validation/").json()["total"] == 0


@pytest.mark.parametrize("path", [
    "/api/accounts/{account}/", "/api/contacts/{contact}/", "/api/contact-lists/{list}/", "/api/templates/{template}/",
    "/api/media/{media}/", "/api/media/{media}/file/", "/api/campaigns/{campaign}/", "/api/campaigns/{campaign}/export/",
])
def test_other_workspace_gets_404_by_id(bob, alice_data, path):
    url = path.format(**{k: v.pk for k, v in alice_data.items()})
    assert signed_in(bob).get(url).status_code == 404


def test_other_workspace_cannot_change_or_delete(bob, alice_data):
    c = signed_in(bob)
    assert c.patch(f"/api/contacts/{alice_data['contact'].pk}/", {"name": "x"}, format="json").status_code == 404
    assert c.delete(f"/api/accounts/{alice_data['account'].pk}/").status_code == 404
    assert c.post(f"/api/campaigns/{alice_data['campaign'].pk}/retry-failed/").status_code == 404
    c.post("/api/contacts/bulk/", {"action": "delete", "ids": [alice_data["contact"].pk]}, format="json")
    assert Contact.objects.filter(pk=alice_data["contact"].pk).exists()


def test_campaign_cannot_use_another_workspaces_accounts_contacts_lists_or_files(bob, alice_data):
    c = signed_in(bob)
    r = c.post("/api/campaigns/", {"message": "Hi", "sender_account_ids": [alice_data["account"].pk],
                                   "contact_ids": [alice_data["contact"].pk]}, format="json")
    assert r.status_code == 400 and "sender_account_ids" in r.json()["fields"]

    own = WhatsAppAccount.objects.create(owner=bob, label="Bob phone", provider="fake", status="connected", phone="8801000000002")
    r = c.post("/api/campaigns/", {"message": "Hi", "sender_account_ids": [own.pk], "contact_ids": [alice_data["contact"].pk],
                                   "contact_list_ids": [alice_data["list"].pk]}, format="json")
    assert r.status_code == 400 and "contact_ids" in r.json()["fields"]  # Alice's people are invisible to Bob

    r = c.post("/api/campaigns/", {"message": "", "media_id": alice_data["media"].pk, "sender_account_ids": [own.pk],
                                   "numbers": "01711111111"}, format="json")
    assert r.status_code == 400 and "media_id" in r.json()["fields"]


def test_contact_cannot_join_another_workspaces_list(bob, alice_data):
    r = signed_in(bob).post("/api/contacts/", {"phone": "01712345678", "lists": [alice_data["list"].pk]}, format="json")
    assert r.status_code == 400


def test_same_number_and_list_name_in_two_workspaces(alice, bob, alice_data):
    c = signed_in(bob)
    assert c.post("/api/contacts/", {"phone": "+8801700000001"}, format="json").status_code == 201
    assert c.post("/api/contact-lists/", {"name": "VIP"}, format="json").status_code == 201
    r = c.post("/api/contacts/import/", {"text": "Name,Phone\nKarim,01700000001", "new_list": "VIP"}, format="json").json()
    assert r["updated"] == 1 and r["created"] == 0
    assert Contact.objects.get(owner=alice, phone="8801700000001").name == "Rahim"  # Alice's copy untouched
    assert Contact.objects.get(owner=bob, phone="8801700000001").name == "Karim"


def test_pasted_numbers_are_saved_to_the_senders_workspace(alice, bob, alice_data):
    own = WhatsAppAccount.objects.create(owner=bob, label="Bob phone", provider="fake", status="connected", phone="8801000000002")
    r = signed_in(bob).post("/api/campaigns/", {"message": "Hi", "sender_account_ids": [own.pk], "numbers": "01700000001"},
                            format="json")
    assert r.status_code == 201
    assert Contact.objects.filter(phone="8801700000001").count() == 2
    assert Campaign.objects.get(pk=r.json()["id"]).owner == bob


def test_settings_are_per_workspace(alice, bob):
    signed_in(alice).patch("/api/settings/", {"daily_limit": 50}, format="json")
    assert signed_in(bob).get("/api/settings/").json()["daily_limit"] == 0
    assert AppSettings.load(alice).daily_limit == 50


# ---------- team members ----------

@pytest.fixture
def employee(alice):
    r = signed_in(alice).post("/api/team/", {"username": "rana", "name": "Rana", "password": PW, "role": "support"}, format="json")
    assert r.status_code == 201, r.json()
    return User.objects.get(username="rana")


def test_team_member_works_in_owners_workspace(alice, employee, alice_data):
    c = signed_in(employee)
    assert c.get("/api/contacts/").json()["count"] == 1
    assert c.get(f"/api/campaigns/{alice_data['campaign'].pk}/").status_code == 200
    r = c.post("/api/contacts/", {"phone": "01799999999", "name": "New"}, format="json")
    assert r.status_code == 201 and Contact.objects.get(pk=r.json()["id"]).owner == alice
    r = c.post("/api/campaigns/", {"message": "Hi", "sender_account_ids": [alice_data["account"].pk],
                                   "contact_ids": [alice_data["contact"].pk]}, format="json")
    camp = Campaign.objects.get(pk=r.json()["id"])
    assert camp.owner == alice and camp.created_by == employee
    me = c.get("/api/auth/session/").json()["user"]
    assert me["is_owner"] is False and me["role"] == "support" and me["workspace"] == "alice"


def test_team_member_cannot_manage_team_or_passwords(employee):
    c = signed_in(employee)
    assert c.get("/api/team/").status_code == 403
    assert c.post("/api/team/", {"username": "x", "password": PW}, format="json").status_code == 403
    r = c.post("/api/auth/password/", {"current_password": PW, "new_password": "another-long-password"}, format="json")
    assert r.status_code == 403


def test_owner_manages_team(alice, bob, employee):
    c = signed_in(alice)
    members = c.get("/api/team/").json()
    assert [(m["username"], m["role"]) for m in members] == [("rana", "support")]
    assert "password" not in members[0]
    mid = members[0]["id"]

    assert c.patch(f"/api/team/{mid}/", {"password": "a-fresh-long-password", "role": "employee"}, format="json").status_code == 200
    login = APIClient().post("/api/auth/login/", {"username": "rana", "password": "a-fresh-long-password"}, format="json")
    assert login.status_code == 200

    assert signed_in(bob).get("/api/team/").json() == []  # Bob doesn't see Alice's team
    assert signed_in(bob).delete(f"/api/team/{mid}/").status_code == 404

    assert c.delete(f"/api/team/{mid}/").status_code == 204
    assert not User.objects.filter(username="rana").exists()


def test_team_member_validation(alice, bob):
    c = signed_in(alice)
    assert "password" in c.post("/api/team/", {"username": "new1"}, format="json").json()["fields"]
    assert "username" in c.post("/api/team/", {"username": "BOB", "password": PW}, format="json").json()["fields"]
    assert "password" in c.post("/api/team/", {"username": "new2", "password": "short"}, format="json").json()["fields"]


def test_deleting_a_member_keeps_their_work(alice, employee, alice_data):
    signed_in(employee).post("/api/templates/", {"title": "T", "body": "B"}, format="json")
    TeamMember.objects.get(user=employee)
    signed_in(alice).delete(f"/api/team/{TeamMember.objects.get(user=employee).pk}/")
    assert MessageTemplate.objects.filter(owner=alice, title="T").exists()


# ---------- registration ----------

def test_signup_is_off_by_default(db):
    c = APIClient()
    assert c.get("/api/auth/session/").json()["signup_enabled"] is False
    assert c.post("/api/auth/register/", {"username": "new", "password": PW}, format="json").status_code == 403


def test_signup_creates_an_empty_workspace_and_signs_in(settings, alice_data):
    settings.ALLOW_SIGNUP = True
    c = APIClient()
    r = c.post("/api/auth/register/", {"username": "karim", "name": "Karim", "password": PW}, format="json")
    assert r.status_code == 201 and r.json()["user"]["is_owner"] is True
    assert c.get("/api/auth/session/").json()["user"]["username"] == "karim"
    assert c.get("/api/contacts/").json()["count"] == 0
    new = User.objects.get(username="karim")
    assert not new.is_staff and not new.is_superuser


@pytest.mark.parametrize("body,field", [
    ({"username": "ALICE", "password": PW}, "username"),
    ({"username": "has space", "password": PW}, "username"),
    ({"username": "new", "password": "password"}, "password"),
])
def test_signup_validation(settings, alice, body, field):
    settings.ALLOW_SIGNUP = True
    r = APIClient().post("/api/auth/register/", body, format="json")
    assert r.status_code == 400 and field in r.json()["fields"]


# ---------- background work ----------

def test_each_workspace_sends_one_campaign_at_a_time_but_side_by_side(alice, bob):
    a1 = Campaign.objects.create(owner=alice, message="a1")
    a2 = Campaign.objects.create(owner=alice, message="a2")
    b1 = Campaign.objects.create(owner=bob, message="b1")
    claimed = {runner.claim_next().pk, runner.claim_next().pk}
    assert claimed == {a1.pk, b1.pk}
    assert runner.claim_next() is None  # Alice's second waits for her first
    Campaign.objects.filter(pk=a1.pk).update(status="completed")
    assert runner.claim_next().pk == a2.pk


def test_numbers_are_checked_with_the_workspaces_own_account(provider, alice, bob):
    acc = WhatsAppAccount.objects.create(owner=alice, label="A", provider="fake", status="connected", phone="8801000000001")
    Contact.objects.create(owner=alice, phone="8801700000001")
    Contact.objects.create(owner=bob, phone="8801700000002")  # Bob has no connected account
    assert validation.validate_pending(pause=0) == 1
    assert provider.checks == [(acc.session_id, ["8801700000001"])]
    assert Contact.objects.get(owner=bob).checked_at is None


def test_ensure_admin_sets_password_on_migration_placeholder(db, monkeypatch):
    User.objects.create(username="admin", password="!", is_superuser=True, is_staff=True)
    monkeypatch.setenv("ADMIN_PASSWORD", PW)
    call_command("ensure_admin")
    assert User.objects.get(username="admin").check_password(PW)
