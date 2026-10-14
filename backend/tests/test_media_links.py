import socket

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.broadcasts import fetch as fetch_mod
from apps.broadcasts.models import MediaFile

pytestmark = pytest.mark.django_db
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


class FakeResp:
    def __init__(self, status=200, body=PNG, headers=None):
        self.status_code = status
        self.headers = headers if headers is not None else {"Content-Type": "image/png", "Content-Length": str(len(body))}
        self._body = body
        self.is_redirect = status in (301, 302, 303, 307, 308)
        self.is_permanent_redirect = status in (301, 308)

    def iter_content(self, n):
        yield self._body

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


@pytest.fixture
def net(monkeypatch):
    """Fake DNS + HTTP. hosts: name -> ip; pages: url -> FakeResp."""
    state = {"hosts": {"mydomain.com": "93.184.216.34"}, "pages": {}}

    def getaddrinfo(host, port, *a, **k):
        if host not in state["hosts"]:
            raise socket.gaierror
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (state["hosts"][host], port))]

    def get(url, **kw):
        return state["pages"][url]

    monkeypatch.setattr(fetch_mod.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(fetch_mod.requests, "get", get)
    return state


def test_attach_by_url(client, net, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    net["pages"]["https://mydomain.com/img/banner"] = FakeResp()
    r = client.post("/api/media/from-url/", {"url": "https://mydomain.com/img/banner"}, format="json")
    assert r.status_code == 201, r.json()
    m = r.json()
    assert m["kind"] == "image" and m["original_name"] == "banner.png" and m["source_url"] == "https://mydomain.com/img/banner"


def test_follows_redirect_but_checks_every_hop(client, net, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    net["hosts"]["internal.example"] = "10.0.0.5"
    net["pages"]["https://mydomain.com/a.png"] = FakeResp(302, b"", {"Location": "http://internal.example/secret.png"})
    r = client.post("/api/media/from-url/", {"url": "https://mydomain.com/a.png"}, format="json")
    assert r.status_code == 400 and "private" in r.json()["error"]


@pytest.mark.parametrize("url,msg", [
    ("ftp://mydomain.com/a.png", "http"),
    ("http://127.0.0.1/a.png", "private"),
    ("http://169.254.169.254/latest/meta-data", "private"),
    ("https://user:pw@mydomain.com/a.png", "password"),
    ("https://mydomain.com:22/a.png", "port"),
    ("https://nope.invalid/a.png", "Couldn't find"),
])
def test_blocks_unsafe_links(client, net, url, msg):
    net["hosts"]["127.0.0.1"] = "127.0.0.1"
    net["hosts"]["169.254.169.254"] = "169.254.169.254"
    r = client.post("/api/media/from-url/", {"url": url}, format="json")
    assert r.status_code == 400 and msg in r.json()["error"]


def test_rejects_web_pages_and_big_files(client, net, settings):
    net["pages"]["https://mydomain.com/page"] = FakeResp(body=b"<html>", headers={"Content-Type": "text/html"})
    assert "web page" in client.post("/api/media/from-url/", {"url": "https://mydomain.com/page"}, format="json").json()["error"]
    settings.MAX_UPLOAD_MB = 0
    net["pages"]["https://mydomain.com/big.png"] = FakeResp()
    assert "larger" in client.post("/api/media/from-url/", {"url": "https://mydomain.com/big.png"}, format="json").json()["error"]


def upload(client, name, data, ctype):
    return client.post("/api/media/", {"file": SimpleUploadedFile(name, data, content_type=ctype)}, format="multipart").json()


def test_public_link_on_off_and_safe_serving(client, settings, tmp_path):
    from rest_framework.test import APIClient

    settings.MEDIA_ROOT = tmp_path
    settings.PUBLIC_BASE_URL = "https://wa.mydomain.com"
    img = upload(client, "poster.png", PNG, "image/png")
    assert img["public_url"] is None

    on = client.post(f"/api/media/{img['id']}/public/", {"public": True}, format="json").json()
    assert on["public_url"].startswith("https://wa.mydomain.com/m/") and on["public_url"].endswith("/poster.png")
    path = on["public_url"].replace("https://wa.mydomain.com", "")

    anon = APIClient()  # no login needed
    r = anon.get(path)
    assert r.status_code == 200 and r["Content-Type"] == "image/png" and "inline" in r["Content-Disposition"]
    assert "sandbox" in r["Content-Security-Policy"]

    # HTML can't be shown from your domain: it downloads instead
    html = upload(client, "x.html", b"<script>alert(1)</script>", "text/html")
    hp = client.post(f"/api/media/{html['id']}/public/", {"public": True}, format="json").json()["public_url"]
    r = anon.get(hp.replace("https://wa.mydomain.com", ""))
    assert r["Content-Type"] == "application/octet-stream" and "attachment" in r["Content-Disposition"]

    client.post(f"/api/media/{img['id']}/public/", {"public": False}, format="json")
    assert anon.get(path).status_code == 404


def test_cleanup_keeps_public_files(client, settings, tmp_path):
    from datetime import timedelta

    from apps.broadcasts.runner import cleanup_unused_media

    settings.MEDIA_ROOT = tmp_path
    keep = upload(client, "keep.png", PNG, "image/png")
    drop = upload(client, "drop.png", PNG, "image/png")
    client.post(f"/api/media/{keep['id']}/public/", {"public": True}, format="json")
    assert cleanup_unused_media(older_than=timedelta(seconds=-1)) == 1
    assert list(MediaFile.objects.values_list("id", flat=True)) == [keep["id"]]
    assert drop["id"] != keep["id"]
