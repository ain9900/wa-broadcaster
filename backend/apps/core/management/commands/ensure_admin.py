import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the first admin user from ADMIN_USERNAME / ADMIN_PASSWORD if no users exist yet."

    def handle(self, *args, **options):
        User = get_user_model()
        username = os.environ.get("ADMIN_USERNAME", "admin")
        password = os.environ.get("ADMIN_PASSWORD", "")
        # A migration may have made a placeholder admin (no usable password) to own existing data.
        placeholder = User.objects.filter(is_superuser=True, password="!").order_by("id").first()
        if User.objects.exists() and not placeholder:
            self.stdout.write("Users already exist; nothing to do.")
            return
        if not password or password.startswith("change-me"):
            self.stderr.write("Set ADMIN_PASSWORD in .env to create the first admin (or run createsuperuser).")
            return
        if placeholder:
            placeholder.set_password(password)
            placeholder.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f'Set the password of admin user "{placeholder.username}".'))
            return
        User.objects.create_superuser(username=username, password=password, email="")
        self.stdout.write(self.style.SUCCESS(f'Created admin user "{username}".'))
