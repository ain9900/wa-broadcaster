from django.conf import settings
from django.db import models

from .phones import jid


class ContactList(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["owner", "name"], name="unique_list_name_per_owner")]

    def __str__(self):
        return self.name


class Contact(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    phone = models.CharField(max_length=16, help_text="International digits, no +. e.g. 8801712345678")
    name = models.CharField(max_length=120, blank=True)
    lists = models.ManyToManyField(ContactList, blank=True, related_name="contacts")
    opted_out = models.BooleanField(default=False, help_text="Never send to this number.")
    on_whatsapp = models.BooleanField(null=True, help_text="Result of the last check. Null = not checked yet.")
    wa_jid = models.CharField(max_length=80, blank=True, help_text="Chat id WhatsApp returned for this number.")
    checked_at = models.DateTimeField(null=True, blank=True, db_index=True, help_text="Empty = waiting to be checked.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "phone"]
        constraints = [models.UniqueConstraint(fields=["owner", "phone"], name="unique_phone_per_owner")]

    def __str__(self):
        return f"{self.name} (+{self.phone})" if self.name else f"+{self.phone}"

    @property
    def jid(self):
        return jid(self.phone)
