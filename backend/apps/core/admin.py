from django.contrib import admin

from .models import AppSettings, TeamMember


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ["user", "daily_limit", "rotation_mode", "updated_at"]


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ["user", "role", "owner", "created_at"]
    list_filter = ["role"]
    search_fields = ["user__username", "owner__username"]
