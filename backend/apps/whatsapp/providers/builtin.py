"""Client for the bundled Node/Baileys gateway in ../../gateway."""
import base64

from .base import BaseProvider, Media, SessionState, WebhookEvent


def _state(d: dict) -> SessionState:
    return SessionState(
        status=d.get("status", "error"), qr=d.get("qr"), phone=d.get("phone", ""), name=d.get("name", ""), error=d.get("error") or ""
    )


class BuiltinProvider(BaseProvider):
    name = "builtin"

    def _headers(self):
        return {"X-Api-Key": self.api_key}

    def ping(self):
        try:
            self.request("GET", "/health", timeout=3)
            return True
        except Exception:
            return False

    def start_session(self, session_id):
        return _state(self.request("PUT", f"/sessions/{session_id}"))

    def get_session(self, session_id):
        d = self.request("GET", f"/sessions/{session_id}", ok_404=True)
        return _state(d) if d else SessionState(status="disconnected")

    def list_sessions(self, session_ids):
        rows = {d["id"]: _state(d) for d in self.request("GET", "/sessions", timeout=5)}
        return {sid: rows.get(sid, SessionState(status="disconnected")) for sid in session_ids}

    def restart_session(self, session_id):
        return _state(self.request("POST", f"/sessions/{session_id}/restart"))

    def delete_session(self, session_id):
        self.request("DELETE", f"/sessions/{session_id}", ok_404=True)

    def send_message(self, session_id, to, text, media: Media | None = None, typing=True):
        body = {"to": to, "text": text, "typing": typing}
        if media:
            body["media"] = {"base64": base64.b64encode(media.data).decode(), "mimetype": media.mimetype, "filename": media.filename}
        self.request("POST", f"/sessions/{session_id}/send", json=body, timeout=180)

    def check_numbers(self, session_id, phones):
        rows = self.request("POST", f"/sessions/{session_id}/check", json={"numbers": list(phones)}, timeout=60)
        found = {r.get("number"): (r.get("jid") if r.get("exists") else None) for r in rows or []}
        return {p: found.get(p) for p in phones}

    def parse_webhook(self, payload):
        sid = str(payload.get("session") or "")
        event = payload.get("event")
        if not sid:
            return []
        if event == "session.status":
            return [WebhookEvent(sid, "status", state=_state(payload.get("data") or {}))]
        return []
