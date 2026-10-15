import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from apps.core.owners import assign_owner


class Migration(migrations.Migration):

    dependencies = [
        ('whatsapp', '0002_remove_groups'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='whatsappaccount',
            name='owner',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(assign_owner('whatsapp', 'WhatsAppAccount'), migrations.RunPython.noop),
        migrations.AlterField(
            model_name='whatsappaccount',
            name='owner',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
    ]
