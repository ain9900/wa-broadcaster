import secrets

from django.core.validators import MaxValueValidator
from django.db import models


def new_session_id():
    return "wa_" + secrets.token_hex(6)


class WhatsAppAccount(models.Model):
    class Status(models.TextChoices):
        STARTING = "starting", "Starting"
        QR = "qr", "Waiting for QR scan"
        CONNECTED = "connected", "Connected"
        RECONNECTING = "reconnecting", "Reconnecting"
        DISCONNECTED = "disconnected", "Not linked"
        LOGGED_OUT = "logged_out", "Logged out from phone"
        ERROR = "error", "Error"

    label = models.CharField(max_length=60)
    session_id = models.CharField(max_length=64, unique=True, default=new_session_id, editable=False)
    provider = models.CharField(max_length=20, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.STARTING)
    phone = models.CharField(max_length=32, blank=True)
    display_name = models.CharField(max_length=120, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    daily_limit = models.PositiveIntegerField(
        null=True, blank=True, validators=[MaxValueValidator(10000)], help_text="Overrides the workspace limit. Empty = use workspace limit."
    )
    connected_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.label} (+{self.phone})" if self.phone else self.label

    @property
    def is_connected(self):
        return self.status == self.Status.CONNECTED
