"""Client for Evolution API v2 (https://doc.evolution-api.com). One Evolution "instance" per account."""
import base64

from .base import (
    CONNECTED, DISCONNECTED, LOGGED_OUT, QR, STARTING,
    BaseProvider, Media, ProviderError, SessionState, WebhookEvent,
)

STATE_MAP = {"open": CONNECTED, "connecting": STARTING, "close": DISCONNECTED}
WEBHOOK_EVENTS = ["CONNECTION_UPDATE", "QRCODE_UPDATED"]


def _digits(jid: str) -> str:
    return str(jid or "").split("@")[0].split(":")[0]


def _qr_data_url(b64: str | None) -> str | None:
    if not b64:
        return None
    return b64 if b64.startswith("data:") else "data:image/png;base64," + b64


class EvolutionProvider(BaseProvider):
    name = "evolution"

    def _headers(self):
        return {"apikey": self.api_key}

    def ping(self):
        try:
            self.request("GET", "/", timeout=3)
            return True
        except Exception:
            return False

    def _instance(self, session_id) -> dict | None:
        rows = self.request("GET", "/instance/fetchInstances", params={"instanceName": session_id}, ok_404=True) or []
        return rows[0] if isinstance(rows, list) and rows else None

    def start_session(self, session_id):
        if not self._instance(session_id):
            created = self.request(
                "POST",
                "/instance/create",
                json={
                    "instanceName": session_id,
                    "integration": "WHATSAPP-BAILEYS",
                    "qrcode": True,
                    "groupsIgnore": True,
                    "alwaysOnline": False,
                    "readMessages": False,
                    "syncFullHistory": False,
                    "webhook": {"url": self.webhook_url, "byEvents": False, "base64": False, "events": WEBHOOK_EVENTS},
                },
            )
            qr = _qr_data_url((created.get("qrcode") or {}).get("base64"))
            if qr:
                return SessionState(status=QR, qr=qr)
        return self.get_session(session_id)

    def get_session(self, session_id):
        inst = self._instance(session_id)
        if not inst:
            return SessionState(status=DISCONNECTED)
        state = inst.get("connectionStatus") or inst.get("instance", {}).get("state") or "close"
        status = STATE_MAP.get(state, DISCONNECTED)
        if status == CONNECTED:
            return SessionState(status=CONNECTED, phone=_digits(inst.get("ownerJid") or inst.get("owner")),
                                name=inst.get("profileName") or "")
        if state == "connecting":
            # Asking to connect returns the current QR code without creating a new instance.
            conn = self.request("GET", f"/instance/connect/{session_id}", ok_404=True) or {}
            qr = _qr_data_url(conn.get("base64"))
            return SessionState(status=QR if qr else STARTING, qr=qr)
        return SessionState(status=status)

    def restart_session(self, session_id):
        if not self._instance(session_id):
            return self.start_session(session_id)
        conn = self.request("GET", f"/instance/connect/{session_id}") or {}
        qr = _qr_data_url(conn.get("base64"))
        return SessionState(status=QR, qr=qr) if qr else self.get_session(session_id)

    def delete_session(self, session_id):
        try:
            self.request("DELETE", f"/instance/logout/{session_id}", ok_404=True)
        except ProviderError:
            pass  # not connected; deleting still works
        self.request("DELETE", f"/instance/delete/{session_id}", ok_404=True)

    def send_message(self, session_id, to, text, media: Media | None = None, typing=True):
        delay = 1500 if typing else 0  # Evolution shows "typing…" for `delay` ms before sending
        if not media:
            self.request("POST", f"/message/sendText/{session_id}", json={"number": to, "text": text, "delay": delay}, timeout=120)
            return
        b64 = base64.b64encode(media.data).decode()
        mt = media.mimetype or "application/octet-stream"
        if mt.startswith("audio/"):
            if text:
                self.request("POST", f"/message/sendText/{session_id}", json={"number": to, "text": text, "delay": delay}, timeout=120)
            self.request("POST", f"/message/sendWhatsAppAudio/{session_id}", json={"number": to, "audio": b64}, timeout=180)
            return
        kind = "image" if mt.startswith("image/") and mt != "image/gif" else "video" if mt.startswith("video/") else "document"
        self.request(
            "POST",
            f"/message/sendMedia/{session_id}",
            json={"number": to, "mediatype": kind, "mimetype": mt, "caption": text or "", "media": b64,
                  "fileName": media.filename, "delay": delay},
            timeout=180,
        )

    def check_numbers(self, session_id, phones):
        rows = self.request("POST", f"/chat/whatsappNumbers/{session_id}", json={"numbers": list(phones)}, timeout=60) or []
        found = {_digits(r.get("number") or r.get("jid")): (r.get("jid") if r.get("exists") else None) for r in rows}
        return {p: found.get(p) for p in phones}

    def parse_webhook(self, payload):
        sid = str(payload.get("instance") or "")
        event = str(payload.get("event") or "").lower().replace("_", ".")
        data = payload.get("data") or {}
        if not sid:
            return []
        if event == "connection.update":
            state = data.get("state")
            if state == "open":
                return [WebhookEvent(sid, "status", state=SessionState(status=CONNECTED, phone=_digits(data.get("wuid")),
                                                                        name=data.get("profileName") or ""))]
            if state == "close":
                logged_out = data.get("statusReason") == 401
                return [WebhookEvent(sid, "status", state=SessionState(status=LOGGED_OUT if logged_out else DISCONNECTED))]
            return [WebhookEvent(sid, "status", state=SessionState(status=STARTING))]
        if event == "qrcode.updated":
            return [WebhookEvent(sid, "status", state=SessionState(status=QR))]
        return []
