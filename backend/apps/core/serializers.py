from django.contrib.auth import password_validation
from rest_framework import serializers

from .models import AppSettings


class AppSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSettings
        exclude = ["id"]
        read_only_fields = ["updated_at"]

    def validate(self, attrs):
        lo = attrs.get("delay_min_seconds", getattr(self.instance, "delay_min_seconds", 10))
        hi = attrs.get("delay_max_seconds", getattr(self.instance, "delay_max_seconds", 25))
        if hi < lo:
            raise serializers.ValidationError({"delay_max_seconds": "The maximum wait must be at least the minimum."})
        return attrs


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=256, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "Your current password is wrong."})
        password_validation.validate_password(attrs["new_password"], user)
        return attrs
