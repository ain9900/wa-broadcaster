import pytest
from rest_framework.test import APIClient

from apps.contacts.models import Contact
from apps.whatsapp.models import WhatsAppAccount
from apps.whatsapp.providers import ProviderError, SessionState
from tests.helpers import me


class FakeProvider:
    name = "fake"
    CHECK_BATCH = 50

    def __init__(self):
        self.sent = []  # (session_id, to, text, media)
        self.fail_for = set()  # chat ids whose send raises
        self.not_on_whatsapp = set()  # phone numbers the WhatsApp check rejects
        self.checks = []  # (session_id, [phones]) per check call
        self.sessions = {}

    def ping(self):
        return True

    def start_session(self, sid):
        self.sessions[sid] = SessionState(status="qr", qr="data:image/png;base64,AAAA")
        return self.sessions[sid]

    def get_session(self, sid):
        return self.sessions.get(sid, SessionState(status="disconnected"))

    def list_sessions(self, ids):
        return {i: self.get_session(i) for i in ids}

    def restart_session(self, sid):
        return self.start_session(sid)

    def delete_session(self, sid):
        self.sessions.pop(sid, None)

    def send_message(self, sid, to, text, media=None, typing=True):
        if to in self.fail_for:
            raise ProviderError("Message rejected")
        self.sent.append((sid, to, text, media))

    def check_numbers(self, sid, phones):
        self.checks.append((sid, list(phones)))
        return {p: (None if p in self.not_on_whatsapp else f"{p}@s.whatsapp.net") for p in phones}

    def check_number(self, sid, phone):
        return self.check_numbers(sid, [phone])[phone]

    def parse_webhook(self, payload):
        from apps.whatsapp.providers.builtin import BuiltinProvider

        return BuiltinProvider.parse_webhook(self, payload)


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()
    import apps.broadcasts.runner as runner
    import apps.contacts.validation as validation
    import apps.whatsapp.providers as providers
    import apps.whatsapp.services as services
    import apps.whatsapp.views as views

    for mod in (runner, services, views, providers, validation):
        monkeypatch.setattr(mod, "get_provider", lambda: fake)
    monkeypatch.setattr(runner, "POLL_EVERY", 0.01)
    return fake


@pytest.fixture(autouse=True)
def _defaults(settings):
    """Tests don't follow the local .env; tests that need sign-up turn it on themselves."""
    settings.ALLOW_SIGNUP = False


@pytest.fixture
def user(db):
    u = me()
    u.set_password("a-long-test-password")
    u.save()
    return u


@pytest.fixture
def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def account(db):
    return WhatsAppAccount.objects.create(owner=me(), label="Office", provider="fake", status="connected", phone="8801000000000")


@pytest.fixture
def contacts(db):
    """Three saved contacts."""
    return [Contact.objects.create(owner=me(), phone=f"88017000000{i}", name=f"C{i}") for i in range(1, 4)]
