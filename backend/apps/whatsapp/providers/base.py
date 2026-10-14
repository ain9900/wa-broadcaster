"""The contract every WhatsApp connection backend implements.

The rest of the app only talks to this interface, so switching between the built-in
Baileys gateway and Evolution API is one setting (WA_PROVIDER).
"""
from dataclasses import dataclass, field

import requests

# Normalised session states (same values as WhatsAppAccount.Status)
STARTING, QR, CONNECTED, RECONNECTING, DISCONNECTED, LOGGED_OUT, ERROR = (
    "starting", "qr", "connected", "reconnecting", "disconnected", "logged_out", "error",
)


class ProviderError(Exception):
    """The provider was unreachable or rejected the request. `message` is safe to show users."""


@dataclass
class SessionState:
    status: str
    qr: str | None = None  # data: URL of the QR image while waiting for a scan
    phone: str = ""
    name: str = ""
    error: str = ""


@dataclass
class Media:
    data: bytes
    mimetype: str
    filename: str


@dataclass
class WebhookEvent:
    session_id: str
    kind: str  # "status"
    state: SessionState | None = None
    extra: dict = field(default_factory=dict)


class BaseProvider:
    name = "base"
    timeout = 20

    def __init__(self, base_url: str, api_key: str, webhook_url: str):
        self.base_url = base_url
        self.api_key = api_key
        self.webhook_url = webhook_url
        self.http = requests.Session()

    # -- HTTP helper ------------------------------------------------------------
    def _headers(self) -> dict:
        raise NotImplementedError

    def request(self, method, path, *, timeout=None, ok_404=False, **kw):
        try:
            r = self.http.request(method, self.base_url + path, headers=self._headers(), timeout=timeout or self.timeout, **kw)
        except requests.RequestException as e:
            raise ProviderError(f"The WhatsApp service ({self.name}) is not reachable. Is it running?") from e
        if ok_404 and r.status_code == 404:
            return None
        if r.status_code >= 400:
            try:
                body = r.json()
                msg = body.get("error") or body.get("message") or body.get("response", {}).get("message")
            except ValueError:
                msg = r.text[:200]
            if isinstance(msg, list):
                msg = "; ".join(map(str, msg))
            raise ProviderError(str(msg or f"WhatsApp service error ({r.status_code})"))
        try:
            return r.json()
        except ValueError:
            return {}

    # -- contract ---------------------------------------------------------------
    def ping(self) -> bool:
        raise NotImplementedError

    def start_session(self, session_id: str) -> SessionState:
        raise NotImplementedError

    def get_session(self, session_id: str) -> SessionState:
        raise NotImplementedError

    def list_sessions(self, session_ids: list[str]) -> dict[str, SessionState]:
        return {sid: self.get_session(sid) for sid in session_ids}

    def restart_session(self, session_id: str) -> SessionState:
        raise NotImplementedError

    def delete_session(self, session_id: str) -> None:
        raise NotImplementedError

    def send_message(self, session_id: str, to: str, text: str, media: Media | None = None, typing: bool = True) -> None:
        raise NotImplementedError

    CHECK_BATCH = 50

    def check_numbers(self, session_id: str, phones: list[str]) -> dict[str, str | None]:
        """For each phone (international digits): the chat id to message it at, or None if it isn't on WhatsApp.
        At most CHECK_BATCH numbers per call."""
        raise NotImplementedError

    def check_number(self, session_id: str, phone: str) -> str | None:
        return self.check_numbers(session_id, [phone]).get(phone)

    def parse_webhook(self, payload: dict) -> list[WebhookEvent]:
        raise NotImplementedError
