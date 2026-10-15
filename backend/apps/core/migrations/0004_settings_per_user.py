import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from apps.core.owners import default_owner


def assign(apps, schema_editor):
    """The old workspace-wide settings row becomes the first admin's settings."""
    AppSettings = apps.get_model('core', 'AppSettings')
    rows = AppSettings.objects.filter(user__isnull=True)
    if rows.exists():
        first = rows.order_by('pk').first()
        first.user = default_owner(apps)
        first.save(update_fields=['user'])
        rows.exclude(pk=first.pk).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_sender_rotation_defaults'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='appsettings',
            name='user',
            field=models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='app_settings', to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(assign, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='appsettings',
            name='user',
            field=models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='app_settings', to=settings.AUTH_USER_MODEL),
        ),
    ]
