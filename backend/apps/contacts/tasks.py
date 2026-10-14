from celery import shared_task

from . import validation


@shared_task(name="contacts.validate_pending")
def validate_pending():
    """Run by Celery beat: check unchecked numbers against WhatsApp, a few batches at a time."""
    return validation.validate_pending()
