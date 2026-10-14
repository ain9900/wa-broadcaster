import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the first admin user from ADMIN_USERNAME / ADMIN_PASSWORD if no users exist yet."

    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.exists():
            self.stdout.write("Users already exist; nothing to do.")
            return
        username = os.environ.get("ADMIN_USERNAME", "admin")
        password = os.environ.get("ADMIN_PASSWORD", "")
        if not password or password.startswith("change-me"):
            self.stderr.write("Set ADMIN_PASSWORD in .env to create the first admin (or run createsuperuser).")
            return
        User.objects.create_superuser(username=username, password=password, email="")
        self.stdout.write(self.style.SUCCESS(f'Created admin user "{username}".'))
