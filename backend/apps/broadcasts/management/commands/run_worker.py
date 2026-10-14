import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from apps.broadcasts import runner
from apps.contacts import validation


class Command(BaseCommand):
    help = "Send campaigns without Celery/Redis (for running without Docker). Use Celery in production."

    def add_arguments(self, parser):
        parser.add_argument("--interval", type=float, default=3, help="Seconds between checks for due campaigns.")

    def handle(self, *args, interval, **options):
        self.stdout.write(self.style.SUCCESS("Worker started. Waiting for campaigns... (Ctrl+C to stop)"))
        runner.recover_stale(force=True)
        last_cleanup = 0.0
        try:
            while True:
                close_old_connections()
                campaign = runner.claim_next()
                if campaign:
                    self.stdout.write(f"Sending campaign #{campaign.pk}")
                    status = runner.run_campaign(campaign.pk)
                    self.stdout.write(f"Campaign #{campaign.pk}: {status}")
                    continue
                checked = validation.validate_pending(max_batches=2)
                if checked:
                    self.stdout.write(f"Checked {checked} numbers on WhatsApp")
                    continue
                if time.monotonic() - last_cleanup > 6 * 3600:
                    runner.cleanup_unused_media()
                    last_cleanup = time.monotonic()
                time.sleep(interval)
        except KeyboardInterrupt:
            self.stdout.write("Worker stopped. A send in progress resumes when the worker starts again.")
