import os
import secrets

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.models import Rotation
from apps.whatsapp.models import WhatsAppAccount


def upload_to(instance, filename):
    ext = os.path.splitext(filename)[1].lower()[:10]
    return timezone.now().strftime(f"uploads/%Y/%m/{secrets.token_hex(12)}{ext}")


class MediaFile(models.Model):
    file = models.FileField(upload_to=upload_to)
    original_name = models.CharField(max_length=200)
    mime_type = models.CharField(max_length=120)
    size = models.PositiveBigIntegerField()
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    source_url = models.URLField(max_length=1000, blank=True, help_text="Where it was downloaded from, if attached by link.")
    public_token = models.CharField(max_length=40, unique=True, null=True, blank=True,
                                    help_text="Set when the file has a public link. Clear it to turn the link off.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_name

    # Types a browser may display on a public link. Anything else (HTML, SVG, scripts…) is forced to
    # download, so nobody can host a working web page on your domain through this.
    INLINE_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp", "video/", "audio/", "application/pdf")

    @property
    def safe_inline(self):
        return any(self.mime_type == t or (t.endswith("/") and self.mime_type.startswith(t)) for t in self.INLINE_TYPES)

    @property
    def kind(self):
        mt = self.mime_type
        if mt == "image/gif" or mt.startswith("video/"):
            return "video"
        for k in ("image", "audio"):
            if mt.startswith(k + "/"):
                return k
        return "document"


class MessageTemplate(models.Model):
    title = models.CharField(max_length=80)
    body = models.TextField(max_length=60000)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class Campaign(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        RUNNING = "running", "Sending"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    ACTIVE = [Status.SCHEDULED, Status.RUNNING, Status.PAUSED]

    name = models.CharField(max_length=120, blank=True)
    message = models.TextField(blank=True, max_length=60000)
    media = models.ForeignKey(MediaFile, null=True, blank=True, on_delete=models.PROTECT, related_name="campaigns")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED, db_index=True)

    delay_min_seconds = models.PositiveIntegerField(default=10, validators=[MinValueValidator(3), MaxValueValidator(600)])
    delay_max_seconds = models.PositiveIntegerField(default=25, validators=[MinValueValidator(3), MaxValueValidator(600)])
    batch_size = models.PositiveIntegerField(default=10, validators=[MaxValueValidator(500)])
    batch_pause_minutes = models.PositiveIntegerField(default=5, validators=[MinValueValidator(1), MaxValueValidator(240)])
    typing_indicator = models.BooleanField(default=True)

    # Which accounts send, and how they take turns.
    sender_accounts = models.ManyToManyField(WhatsAppAccount, blank=True, related_name="sender_campaigns")
    rotation_mode = models.CharField(max_length=10, choices=Rotation.choices, default=Rotation.TURNS)
    rotate_every = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(100)])
    failover = models.BooleanField(default=True)
    rotation_account = models.ForeignKey(WhatsAppAccount, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
                                         help_text="Take turns: the account whose turn it is.")
    rotation_used = models.PositiveIntegerField(default=0, help_text="Take turns: messages it has sent in this turn.")

    scheduled_at = models.DateTimeField(default=timezone.now, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    next_action_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name or (self.message[:50] if self.message else f"Campaign #{self.pk}")


class CampaignTarget(models.Model):
    """One recipient of a campaign: a contact's number."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name="targets")
    account = models.ForeignKey(WhatsAppAccount, null=True, on_delete=models.SET_NULL, related_name="campaign_targets")
    account_label = models.CharField(max_length=60)
    contact = models.ForeignKey("contacts.Contact", null=True, blank=True, on_delete=models.SET_NULL, related_name="campaign_targets")
    recipient_jid = models.CharField(max_length=80)
    recipient_name = models.CharField(max_length=200, blank=True)
    position = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    error = models.CharField(max_length=300, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["campaign", "status", "position"]),
            models.Index(fields=["account", "status", "sent_at"]),
        ]

    def __str__(self):
        return f"{self.recipient_name or self.recipient_jid} via {self.account_label}"
