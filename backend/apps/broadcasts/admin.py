from django.contrib import admin

from .models import Campaign, CampaignTarget, MediaFile, MessageTemplate


class TargetInline(admin.TabularInline):
    model = CampaignTarget
    extra = 0
    fields = ["position", "recipient_name", "recipient_jid", "account_label", "status", "error", "sent_at"]
    readonly_fields = fields
    can_delete = False


@admin.register(Campaign)
class CampaignAdmin(admin.ModelAdmin):
    list_display = ["id", "__str__", "owner", "status", "scheduled_at", "started_at", "finished_at", "created_by"]
    list_filter = ["status", "owner"]
    search_fields = ["name", "message"]
    readonly_fields = ["started_at", "finished_at", "next_action_at", "heartbeat_at", "note"]
    inlines = [TargetInline]


@admin.register(MessageTemplate)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ["title", "owner", "updated_at"]
    search_fields = ["title", "body"]


@admin.register(MediaFile)
class MediaFileAdmin(admin.ModelAdmin):
    list_display = ["original_name", "owner", "mime_type", "size", "created_at"]
