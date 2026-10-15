from django.contrib import admin

from .models import WhatsAppAccount


@admin.register(WhatsAppAccount)
class WhatsAppAccountAdmin(admin.ModelAdmin):
    list_display = ["label", "phone", "owner", "status", "provider", "daily_limit", "created_at"]
    list_filter = ["status", "provider", "owner"]
    search_fields = ["label", "phone", "session_id"]
    readonly_fields = ["session_id", "provider", "status", "phone", "display_name", "last_error", "connected_at"]
