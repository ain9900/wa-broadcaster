import re
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.contacts.models import Contact
from apps.contacts.phones import jid as phone_jid
from apps.contacts.phones import normalize
from apps.core.models import AppSettings, Rotation
from apps.whatsapp.models import WhatsAppAccount

from .models import Campaign, CampaignTarget, MediaFile, MessageTemplate

MAX_TARGETS = 20000


def public_media_url(m, request=None) -> str | None:
    """Full public link on your domain, e.g. https://wa.example.com/m/<token>/banner.jpg."""
    if not m.public_token:
        return None
    path = f"/m/{m.public_token}/{quote(m.original_name)}"
    base = settings.PUBLIC_BASE_URL
    if not base and request is not None:
        base = request.build_absolute_uri("/").rstrip("/")
    return (base or "") + path


class MediaFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()

    class Meta:
        model = MediaFile
        fields = ["id", "original_name", "mime_type", "size", "kind", "url", "public_url", "source_url", "created_at"]

    def get_url(self, obj):
        return f"/api/media/{obj.id}/file/"

    def get_public_url(self, obj):
        return public_media_url(obj, self.context.get("request"))


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageTemplate
        fields = ["id", "title", "body", "created_at", "updated_at"]

    def validate_title(self, v):
        if not v.strip():
            raise serializers.ValidationError("Give the template a name.")
        return v.strip()

    def validate_body(self, v):
        if not v.strip():
            raise serializers.ValidationError("A template needs some text.")
        return v


class CampaignTargetSerializer(serializers.ModelSerializer):
    account_id = serializers.IntegerField(read_only=True)
    contact_id = serializers.IntegerField(read_only=True)
    phone = serializers.SerializerMethodField()

    class Meta:
        model = CampaignTarget
        fields = ["id", "contact_id", "account_id", "account_label", "phone", "recipient_name",
                  "status", "error", "attempts", "sent_at", "finished_at"]

    def get_phone(self, obj):
        return obj.recipient_jid.split("@")[0]


class CampaignListSerializer(serializers.ModelSerializer):
    media = MediaFileSerializer(read_only=True)
    total = serializers.IntegerField(read_only=True)
    sent = serializers.IntegerField(read_only=True)
    failed = serializers.IntegerField(read_only=True)
    skipped = serializers.IntegerField(read_only=True)
    pending = serializers.IntegerField(read_only=True)
    created_by = serializers.SlugRelatedField(slug_field="username", read_only=True)
    sender_account_ids = serializers.PrimaryKeyRelatedField(source="sender_accounts", many=True, read_only=True)

    class Meta:
        model = Campaign
        fields = [
            "id", "name", "message", "media", "status", "delay_min_seconds", "delay_max_seconds", "batch_size",
            "batch_pause_minutes", "typing_indicator", "scheduled_at", "started_at", "finished_at", "next_action_at",
            "note", "created_by", "created_at", "total", "sent", "failed", "skipped", "pending",
            "sender_account_ids", "rotation_mode", "rotate_every", "failover",
        ]


class CampaignDetailSerializer(CampaignListSerializer):
    targets = CampaignTargetSerializer(many=True, read_only=True)

    class Meta(CampaignListSerializer.Meta):
        fields = CampaignListSerializer.Meta.fields + ["targets"]


class CampaignCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    message = serializers.CharField(max_length=60000, required=False, allow_blank=True, trim_whitespace=False)
    media_id = serializers.IntegerField(required=False, allow_null=True)
    # Recipients: saved contacts, whole lists and/or pasted numbers (pasted ones are saved to Contacts).
    contact_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=MAX_TARGETS)
    contact_list_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=200)
    numbers = serializers.CharField(required=False, allow_blank=True, max_length=1_000_000)
    # Which accounts send, and how they share the work.
    sender_account_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=100)
    rotation_mode = serializers.ChoiceField(choices=Rotation.choices, required=False)
    rotate_every = serializers.IntegerField(min_value=1, max_value=100, required=False)
    failover = serializers.BooleanField(required=False)

    delay_min_seconds = serializers.IntegerField(min_value=3, max_value=600, required=False)
    delay_max_seconds = serializers.IntegerField(min_value=3, max_value=600, required=False)
    batch_size = serializers.IntegerField(min_value=0, max_value=500, required=False)
    batch_pause_minutes = serializers.IntegerField(min_value=1, max_value=240, required=False)
    typing_indicator = serializers.BooleanField(required=False)
    scheduled_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        defaults = AppSettings.load()
        for f in ("delay_min_seconds", "delay_max_seconds", "batch_size", "batch_pause_minutes", "typing_indicator",
                  "rotation_mode", "rotate_every", "failover"):
            attrs.setdefault(f, getattr(defaults, f))
        if attrs["delay_max_seconds"] < attrs["delay_min_seconds"]:
            attrs["delay_min_seconds"], attrs["delay_max_seconds"] = attrs["delay_max_seconds"], attrs["delay_min_seconds"]

        media = None
        if attrs.get("media_id"):
            media = MediaFile.objects.filter(pk=attrs["media_id"]).first()
            if not media:
                raise serializers.ValidationError({"media_id": "The attached file is gone. Attach it again."})
        attrs["media"] = media
        if not (attrs.get("message") or "").strip() and not media:
            raise serializers.ValidationError({"message": "Write a message or attach a file first."})

        when = attrs.get("scheduled_at")
        if when and when < timezone.now() - timedelta(minutes=1):
            raise serializers.ValidationError({"scheduled_at": "The scheduled time is in the past."})
        attrs["scheduled_at"] = when or timezone.now()

        senders = list(WhatsAppAccount.objects.filter(
            pk__in=attrs["sender_account_ids"], status=WhatsAppAccount.Status.CONNECTED).order_by("id"))
        if not senders:
            raise serializers.ValidationError({"sender_account_ids": "Pick at least one connected WhatsApp account to send from."})

        contacts, invalid = self._resolve_contacts(attrs, defaults.default_country_code)
        if not contacts:
            raise serializers.ValidationError({"contact_ids": (
                "None of these numbers are on WhatsApp." if invalid else "Add some numbers: import a file, paste them, or pick a list.")})
        if len(contacts) > MAX_TARGETS:
            raise serializers.ValidationError({"contact_ids": f"You can send to at most {MAX_TARGETS} numbers at once."})
        attrs.update(resolved_contacts=contacts, senders=senders)
        return attrs

    def _resolve_contacts(self, attrs, country_code):
        """Saved contacts + list members + pasted numbers, de-duplicated. Opted-out contacts and numbers
        already validated as not on WhatsApp are left out. Returns (contacts, how many were not on WhatsApp)."""
        picked = {c.phone: c for c in Contact.objects.filter(pk__in=attrs["contact_ids"])}
        if attrs["contact_list_ids"]:
            for c in Contact.objects.filter(lists__id__in=attrs["contact_list_ids"]).distinct():
                picked.setdefault(c.phone, c)
        pasted, bad = [], []
        for token in filter(None, (t.strip() for t in re.split(r"[\n,;]+", attrs.get("numbers") or ""))):
            phone = normalize(token, country_code)
            if phone:
                pasted.append(phone)
            else:
                bad.append(token)
        if bad:
            more = " …" if len(bad) > 5 else ""
            raise serializers.ValidationError({"numbers": f"These don't look like phone numbers: {', '.join(bad[:5])}{more}"})
        if pasted:
            known = set(Contact.objects.filter(phone__in=pasted).values_list("phone", flat=True))
            Contact.objects.bulk_create([Contact(phone=p) for p in dict.fromkeys(pasted) if p not in known], ignore_conflicts=True)
            saved = {c.phone: c for c in Contact.objects.filter(phone__in=pasted)}
            for p in pasted:
                picked.setdefault(p, saved[p])
        usable = [c for c in picked.values() if not c.opted_out]
        not_on_wa = sum(1 for c in usable if c.on_whatsapp is False)
        return [c for c in usable if c.on_whatsapp is not False], not_on_wa

    def create(self, validated):
        contacts = validated.pop("resolved_contacts")
        senders = validated.pop("senders")
        for k in ("media_id", "contact_ids", "contact_list_ids", "numbers", "sender_account_ids"):
            validated.pop(k, None)
        msg = validated.get("message") or ""
        if not validated.get("name"):
            first_line = msg.strip().splitlines()[0] if msg.strip() else (validated["media"].original_name if validated["media"] else "")
            validated["name"] = first_line.strip("*_~` ")[:120]
        campaign = Campaign.objects.create(created_by=self.context["request"].user, **validated)
        campaign.sender_accounts.set(senders)
        # The sending account is chosen when each message goes out, following the rotation settings.
        CampaignTarget.objects.bulk_create([
            CampaignTarget(campaign=campaign, account=None, account_label="", contact=c,
                           recipient_jid=phone_jid(c.phone), recipient_name=c.name, position=i)
            for i, c in enumerate(contacts)
        ], batch_size=1000)
        return campaign
