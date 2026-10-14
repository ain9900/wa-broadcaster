import pytest

from apps.broadcasts import runner
from apps.broadcasts.models import Campaign, CampaignTarget
from apps.contacts.models import Contact, ContactList
from apps.contacts.phones import normalize, parse_lines
from apps.whatsapp.models import WhatsAppAccount

pytestmark = pytest.mark.django_db
T = CampaignTarget.Status


@pytest.mark.parametrize("raw,cc,expected", [
    ("+880 1712-345678", "", "8801712345678"),
    ("00880 1712 345678", "", "8801712345678"),
    ("8801712345678", "", "8801712345678"),
    ("01712345678", "880", "8801712345678"),
    ("01712345678", "", None),  # local number and no country code to complete it
    ("12345", "880", None),
    ("hello", "880", None),
])
def test_normalize(raw, cc, expected):
    assert normalize(raw, cc) == expected


def test_parse_lines_handles_csv_and_names_in_either_column():
    rows = list(parse_lines("name,phone\nRahim, 01712345678\n+8801812345678;Karim\nnot a number", "880"))
    parsed = [(phone, name) for _, phone, name, _ in rows]
    assert parsed == [(None, "name phone"), ("8801712345678", "Rahim"), ("8801812345678", "Karim"), (None, "not a number")]


def test_import_creates_updates_and_lists(client):
    Contact.objects.create(phone="8801712345678", name="Old")
    r = client.post("/api/contacts/import/", {
        "text": "name,phone\nRahim,01712345678\nKarim,01812345678\nKarim again,01812345678\ngarbage",
        "new_list": "Customers",
    }, format="json").json()
    assert r["created"] == 1 and r["updated"] == 1 and r["total"] == 2
    assert r["invalid_count"] == 1 and r["invalid"][0]["text"] == "garbage"
    assert Contact.objects.get(phone="8801712345678").name == "Rahim"
    assert ContactList.objects.get(name="Customers").contacts.count() == 2


def test_contact_create_normalizes_and_rejects_duplicates(client):
    r = client.post("/api/contacts/", {"phone": "01712345678", "name": "A"}, format="json")
    assert r.status_code == 201 and r.json()["phone"] == "8801712345678"
    dup = client.post("/api/contacts/", {"phone": "+880 1712 345678"}, format="json")
    assert dup.status_code == 400 and "already" in dup.json()["error"]


def test_bulk_opt_out_and_list_membership(client):
    a = Contact.objects.create(phone="8801700000001")
    b = Contact.objects.create(phone="8801700000002")
    lst = ContactList.objects.create(name="VIP")
    client.post("/api/contacts/bulk/", {"action": "add_to_list", "ids": [a.id, b.id], "list_id": lst.id}, format="json")
    client.post("/api/contacts/bulk/", {"action": "opt_out", "ids": [b.id]}, format="json")
    lists = client.get("/api/contact-lists/").json()
    assert lists[0]["contact_count"] == 1  # opted-out contacts don't count
    assert client.get(f"/api/contacts/?list={lst.id}").json()["count"] == 2


def second_account():
    return WhatsAppAccount.objects.create(label="Shop", provider="fake", status="connected", phone="8801999999999")


def test_campaign_to_contacts_collects_recipients_and_skips_opted_out(client, account, provider):
    shop = second_account()
    lst = ContactList.objects.create(name="Customers")
    for i in range(3):
        lst.contacts.add(Contact.objects.create(phone=f"88017000000{i}", name=f"C{i}"))
    Contact.objects.create(phone="8801700000099", opted_out=True).lists.add(lst)

    r = client.post("/api/campaigns/", {
        "message": "Hi {name|friend}!",
        "contact_list_ids": [lst.id],
        "numbers": "01800000001, +8801800000002",
        "sender_account_ids": [account.id, shop.id],
    }, format="json")
    assert r.status_code == 201, r.json()
    targets = r.json()["targets"]
    assert len(targets) == 5  # 3 from the list + 2 pasted, opted-out left out
    assert sorted(r.json()["sender_account_ids"]) == sorted([account.id, shop.id])
    assert Contact.objects.filter(phone="8801800000001").exists()  # pasted numbers are saved


def test_campaign_needs_a_sender(client, account):
    c = Contact.objects.create(phone="8801700000001")
    r = client.post("/api/campaigns/", {"message": "x", "contact_ids": [c.id]}, format="json")
    assert r.status_code == 400 and "account" in r.json()["error"]


def test_bad_pasted_numbers_are_reported(client, account):
    r = client.post("/api/campaigns/", {"message": "x", "numbers": "123, abc", "sender_account_ids": [account.id]}, format="json")
    assert r.status_code == 400 and "phone numbers" in r.json()["error"]


def make_contact_campaign(account, contacts, message="Hello {name|there}"):
    c = Campaign.objects.create(message=message, delay_min_seconds=0, delay_max_seconds=0, batch_size=0)
    c.sender_accounts.set([account])
    for i, ct in enumerate(contacts):
        CampaignTarget.objects.create(campaign=c, contact=ct, recipient_jid=f"{ct.phone}@s.whatsapp.net",
                                      recipient_name=ct.name, position=i)
    return c


def test_runner_personalizes_checks_numbers_and_honours_late_opt_out(provider, account):
    rahim = Contact.objects.create(phone="8801700000001", name="Rahim")
    noname = Contact.objects.create(phone="8801700000002")
    ghost = Contact.objects.create(phone="8801700000003", name="Ghost")
    late = Contact.objects.create(phone="8801700000004", name="Late")
    provider.not_on_whatsapp = {"8801700000003"}
    c = make_contact_campaign(account, [rahim, noname, ghost, late])
    Contact.objects.filter(pk=late.pk).update(opted_out=True)  # opted out after the campaign was created

    runner.claim_next()
    runner.run_campaign(c.pk)

    assert [(to, text) for _, to, text, _ in provider.sent] == [
        ("8801700000001@s.whatsapp.net", "Hello Rahim"),
        ("8801700000002@s.whatsapp.net", "Hello there"),
    ]
    st = dict(c.targets.values_list("recipient_name", "status"))
    assert st["Ghost"] == T.FAILED and st["Late"] == T.SKIPPED
    ghost.refresh_from_db()
    rahim.refresh_from_db()
    assert ghost.on_whatsapp is False and rahim.on_whatsapp is True


def test_personalize():
    assert runner.personalize("Hi {name}, {NAME|x}", "Ana") == "Hi Ana, Ana"
    assert runner.personalize("Hi {name|friend}!", "") == "Hi friend!"
    assert runner.personalize("Hi {name}!", "") == "Hi !"
