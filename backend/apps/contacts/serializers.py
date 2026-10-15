from rest_framework import serializers

from apps.core.models import AppSettings
from apps.core.workspace import workspace_of

from .models import Contact, ContactList
from .phones import normalize


class WorkspaceSerializer(serializers.ModelSerializer):
    @property
    def workspace(self):
        return workspace_of(self.context["request"].user)


class ContactListSerializer(WorkspaceSerializer):
    contact_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = ContactList
        fields = ["id", "name", "contact_count", "created_at"]

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError("Give the list a name.")
        clash = ContactList.objects.filter(owner=self.workspace, name__iexact=v)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f'You already have a list called "{v}".')
        return v


class OwnListsField(serializers.PrimaryKeyRelatedField):
    """Only lists in the request's workspace can be picked."""

    def get_queryset(self):
        return ContactList.objects.filter(owner=workspace_of(self.context["request"].user))


class ContactSerializer(WorkspaceSerializer):
    lists = OwnListsField(many=True, required=False)

    class Meta:
        model = Contact
        fields = ["id", "phone", "name", "lists", "opted_out", "on_whatsapp", "checked_at", "created_at", "updated_at"]
        read_only_fields = ["on_whatsapp", "checked_at", "created_at", "updated_at"]
        extra_kwargs = {"phone": {"validators": []}}  # uniqueness is checked after normalising

    def validate_phone(self, v):
        phone = normalize(v, AppSettings.load(self.workspace).default_country_code)
        if not phone:
            raise serializers.ValidationError("That doesn't look like a phone number. Include the country code, e.g. +8801712345678.")
        clash = Contact.objects.filter(owner=self.workspace, phone=phone)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"+{phone} is already in your contacts.")
        return phone

    def update(self, instance, validated):
        if "phone" in validated and validated["phone"] != instance.phone:
            # A new number has to be checked again.
            instance.on_whatsapp, instance.wa_jid, instance.checked_at = None, "", None
        return super().update(instance, validated)


class ImportSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=2_000_000, trim_whitespace=False)
    list_id = serializers.IntegerField(required=False, allow_null=True)
    new_list = serializers.CharField(max_length=80, required=False, allow_blank=True)
    update_names = serializers.BooleanField(default=True)


class BulkSerializer(serializers.Serializer):
    ACTIONS = ["delete", "add_to_list", "remove_from_list", "opt_out", "opt_in", "recheck"]
    action = serializers.ChoiceField(choices=ACTIONS)
    ids = serializers.ListField(child=serializers.IntegerField(), max_length=50000)
    list_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs["action"] in ("add_to_list", "remove_from_list") and not attrs.get("list_id"):
            raise serializers.ValidationError({"list_id": "Pick a list."})
        return attrs
