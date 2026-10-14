from celery import shared_task
from celery.signals import worker_ready

from . import runner


@shared_task(name="broadcasts.dispatch_due_campaigns")
def dispatch_due_campaigns():
    """Run by Celery beat every few seconds: start the next due campaign, if any."""
    campaign = runner.claim_next()
    if campaign:
        run_campaign.delay(campaign.pk)
        return campaign.pk
    return None


@shared_task(name="broadcasts.run_campaign")
def run_campaign(campaign_id):
    return runner.run_campaign(campaign_id)


@shared_task(name="broadcasts.cleanup_unused_media")
def cleanup_unused_media():
    return runner.cleanup_unused_media()


@worker_ready.connect
def resume_interrupted(**kwargs):
    """The compose stack runs a single worker, so anything still "running" at boot was interrupted."""
    runner.recover_stale(force=True)
