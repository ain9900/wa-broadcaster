from rest_framework import serializers

from .models import WhatsAppAccount


class AccountSerializer(serializers.ModelSerializer):
    sent_today = serializers.SerializerMethodField()
    effective_daily_limit = serializers.SerializerMethodField()
    qr = serializers.SerializerMethodField()

    class Meta:
        model = WhatsAppAccount
        fields = [
            "id", "label", "session_id", "provider", "status", "phone", "display_name", "last_error",
            "daily_limit", "effective_daily_limit", "sent_today", "connected_at", "created_at", "qr",
        ]
        read_only_fields = [f for f in fields if f not in ("label", "daily_limit")]

    def get_sent_today(self, obj):
        return self.context.get("sent_today", {}).get(obj.id, 0)

    def get_effective_daily_limit(self, obj):
        return obj.daily_limit if obj.daily_limit is not None else self.context.get("workspace_limit", 0)

    def get_qr(self, obj):
        st = self.context.get("live", {}).get(obj.id)
        return st.qr if st and obj.status == WhatsAppAccount.Status.QR else None

    def validate_label(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError("Give the account a name.")
        return v
