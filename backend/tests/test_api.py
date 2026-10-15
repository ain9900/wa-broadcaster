from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.broadcasts.models import Campaign
from apps.whatsapp.models import WhatsAppAccount

pytestmark = pytest.mark.django_db


def test_api_requires_login(db):
    r = APIClient().get("/api/campaigns/")
    assert r.status_code == 401
    assert "error" in r.json()


def test_login_and_session(user):
    c = APIClient(enforce_csrf_checks=False)
    assert c.get("/api/auth/session/").json() == {"user": None, "signup_enabled": False}
    bad = c.post("/api/auth/login/", {"username": "admin", "password": "nope"}, format="json")
    assert bad.status_code == 401
    ok = c.post("/api/auth/login/", {"username": "admin", "password": "a-long-test-password"}, format="json")
    assert ok.status_code == 200
    assert c.get("/api/auth/session/").json()["user"]["username"] == "admin"


def new_campaign(client, account, **body):
    return client.post("/api/campaigns/", {"message": "Hi", "sender_account_ids": [account.id], **body}, format="json")


def test_create_campaign_dedupes_and_leaves_out_known_invalid(client, account, contacts):
    contacts[2].on_whatsapp = False
    contacts[2].save()
    r = new_campaign(client, account, contact_ids=[c.id for c in contacts], numbers=f"+{contacts[0].phone}")
    assert r.status_code == 201, r.json()
    body = r.json()
    assert [t["phone"] for t in body["targets"]] == [contacts[0].phone, contacts[1].phone]
    assert body["status"] == "scheduled" and body["name"] == "Hi"


def test_create_campaign_validation(client, account, contacts):
    ids = [contacts[0].id]
    assert new_campaign(client, account, message=" ", contact_ids=ids).status_code == 400
    assert "Add some numbers" in new_campaign(client, account).json()["error"]
    past = (timezone.now() - timedelta(hours=1)).isoformat()
    r = new_campaign(client, account, contact_ids=ids, scheduled_at=past)
    assert r.status_code == 400 and "past" in r.json()["error"]
    account.status = "disconnected"
    account.save()
    assert "connected" in new_campaign(client, account, contact_ids=ids).json()["error"]


def test_all_numbers_invalid(client, account, contacts):
    contacts[0].on_whatsapp = False
    contacts[0].save()
    r = new_campaign(client, account, contact_ids=[contacts[0].id])
    assert r.status_code == 400 and "None of these numbers are on WhatsApp" in r.json()["error"]


def test_pause_resume_cancel(client, account, contacts):
    cid = new_campaign(client, account, contact_ids=[contacts[0].id]).json()["id"]
    assert client.post(f"/api/campaigns/{cid}/pause/").json()["status"] == "paused"
    assert client.post(f"/api/campaigns/{cid}/resume/").json()["status"] == "scheduled"
    r = client.post(f"/api/campaigns/{cid}/cancel/").json()
    assert r["status"] == "cancelled" and r["skipped"] == 1
    assert client.post(f"/api/campaigns/{cid}/cancel/").status_code == 409


def test_retry_failed_creates_new_campaign(client, account, contacts):
    cid = new_campaign(client, account, contact_ids=[c.id for c in contacts[:2]], rotate_every=2).json()["id"]
    Campaign.objects.get(pk=cid).targets.filter(position=1).update(status="failed", account=account)
    r = client.post(f"/api/campaigns/{cid}/retry-failed/")
    assert r.status_code == 201
    body = r.json()
    assert [x["phone"] for x in body["targets"]] == [contacts[1].phone]
    assert body["targets"][0]["account_id"] is None and body["rotate_every"] == 2 and body["sender_account_ids"] == [account.id]


def test_upload_and_attach_media(client, account, contacts, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    up = client.post("/api/media/", {"file": SimpleUploadedFile("poster.png", b"\x89PNG....", content_type="image/png")}, format="multipart")
    assert up.status_code == 201
    m = up.json()
    assert m["kind"] == "image" and m["original_name"] == "poster.png"
    assert client.get(m["url"]).status_code == 200
    r = new_campaign(client, account, message="", media_id=m["id"], contact_ids=[contacts[0].id])
    assert r.status_code == 201 and r.json()["name"] == "poster.png"


def test_link_account_and_webhook_connects(client, provider, settings):
    settings.GATEWAY_API_KEY = "secret"
    r = client.post("/api/accounts/", {"label": "Phone"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "qr" and r.json()["qr"].startswith("data:image")
    sid = r.json()["session_id"]

    hook = {"event": "session.status", "session": sid, "data": {"status": "connected", "phone": "8801", "name": "Me"}}
    assert APIClient().post("/api/whatsapp/webhook/", hook, format="json").status_code == 403
    ok = APIClient().post("/api/whatsapp/webhook/?token=secret", hook, format="json")
    assert ok.status_code == 200 and ok.json()["handled"] == 1
    acc = WhatsAppAccount.objects.get(session_id=sid)
    assert acc.status == "connected" and acc.phone == "8801"


def test_settings_validation(client):
    r = client.put("/api/settings/", {"delay_min_seconds": 30, "delay_max_seconds": 10}, format="json")
    assert r.status_code == 400
    r = client.put("/api/settings/", {"daily_limit": 50, "rotation_mode": "random", "rotate_every": 3}, format="json")
    assert r.status_code == 200 and r.json()["daily_limit"] == 50 and r.json()["rotation_mode"] == "random"


def test_dashboard(client, account):
    d = client.get("/api/dashboard/").json()
    assert d["accounts"] == {"total": 1, "connected": 1}
    assert len(d["last_7_days"]) == 7
