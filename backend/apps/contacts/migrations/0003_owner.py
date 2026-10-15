import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from apps.core.owners import assign_owner


def owner_fk(**kw):
    return models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL, **kw)


class Migration(migrations.Migration):

    dependencies = [
        ('contacts', '0002_number_validation'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name='contact', name='owner', field=owner_fk(null=True)),
        migrations.AddField(model_name='contactlist', name='owner', field=owner_fk(null=True)),
        migrations.RunPython(assign_owner('contacts', 'Contact', 'ContactList'), migrations.RunPython.noop),
        migrations.AlterField(model_name='contact', name='owner', field=owner_fk()),
        migrations.AlterField(model_name='contactlist', name='owner', field=owner_fk()),
        # Numbers and list names are now unique per user instead of across the whole site.
        migrations.AlterField(
            model_name='contact',
            name='phone',
            field=models.CharField(help_text='International digits, no +. e.g. 8801712345678', max_length=16),
        ),
        migrations.AlterField(model_name='contactlist', name='name', field=models.CharField(max_length=80)),
        migrations.AddConstraint(
            model_name='contact',
            constraint=models.UniqueConstraint(fields=('owner', 'phone'), name='unique_phone_per_owner'),
        ),
        migrations.AddConstraint(
            model_name='contactlist',
            constraint=models.UniqueConstraint(fields=('owner', 'name'), name='unique_list_name_per_owner'),
        ),
    ]
