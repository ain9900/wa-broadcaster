from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import AppSettings, TeamMember


class AppSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSettings
        exclude = ["id", "user"]
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


USERNAME_RE = r"^[\w.@+-]+$"
USERNAME_ERRORS = {"invalid": "Use only letters, numbers and . @ + - _ in the username."}


def check_password(password, username):
    """Run the password rules, reporting problems on the password field."""
    try:
        password_validation.validate_password(password, get_user_model()(username=username))
    except DjangoValidationError as e:
        raise serializers.ValidationError({"password": list(e.messages)})


def clean_username(v, exclude_pk=None):
    v = v.strip()
    if not v:
        raise serializers.ValidationError("Choose a username.")
    taken = get_user_model().objects.filter(username__iexact=v)
    if exclude_pk:
        taken = taken.exclude(pk=exclude_pk)
    if taken.exists():
        raise serializers.ValidationError("That username is taken. Try another.")
    return v


class RegisterSerializer(serializers.Serializer):
    username = serializers.RegexField(USERNAME_RE, max_length=150, error_messages=USERNAME_ERRORS)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(trim_whitespace=False, max_length=256)

    def validate_username(self, v):
        return clean_username(v)

    def validate(self, attrs):
        check_password(attrs["password"], attrs["username"])
        return attrs

    def create_user(self):
        d = self.validated_data
        return get_user_model().objects.create_user(username=d["username"], password=d["password"], first_name=d.get("name", ""))


class TeamMemberSerializer(serializers.ModelSerializer):
    """A team member as the workspace owner sees them. `password` sets (or resets) their password."""

    username = serializers.RegexField(USERNAME_RE, max_length=150, source="user.username", error_messages=USERNAME_ERRORS)
    name = serializers.CharField(source="user.first_name", max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False, max_length=256)
    last_login = serializers.DateTimeField(source="user.last_login", read_only=True)

    class Meta:
        model = TeamMember
        fields = ["id", "username", "name", "role", "password", "last_login", "created_at"]

    def validate_username(self, v):
        return clean_username(v, exclude_pk=self.instance.user_id if self.instance else None)

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Set a password for the new team member."})
        if attrs.get("password"):
            username = attrs.get("user", {}).get("username") or (self.instance.user.username if self.instance else "")
            check_password(attrs["password"], username)
        return attrs

    def create(self, validated):
        u = validated.pop("user")
        user = get_user_model().objects.create_user(
            username=u["username"], password=validated.pop("password"), first_name=u.get("first_name", ""))
        return TeamMember.objects.create(user=user, owner=self.context["owner"], **validated)

    def update(self, member, validated):
        user = member.user
        for k, v in validated.pop("user", {}).items():
            setattr(user, k, v)
        if validated.get("password"):
            user.set_password(validated.pop("password"))
        user.save()
        member.role = validated.get("role", member.role)
        member.save(update_fields=["role"])
        return member
