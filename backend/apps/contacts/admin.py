from django.contrib import admin

from .models import Contact, ContactList


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ["phone", "name", "opted_out", "on_whatsapp", "created_at"]
    list_filter = ["opted_out", "on_whatsapp", "lists"]
    search_fields = ["phone", "name"]
    filter_horizontal = ["lists"]


@admin.register(ContactList)
class ContactListAdmin(admin.ModelAdmin):
    list_display = ["name", "created_at"]
