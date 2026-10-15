import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from apps.core.owners import default_owner


def owner_fk(**kw):
    return models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL, **kw)


def assign(apps, schema_editor):
    """Existing rows keep the person who made them where that is known; the rest go to the first admin."""
    names = ('MediaFile', 'MessageTemplate', 'Campaign')
    creator = {'MediaFile': 'uploaded_by', 'MessageTemplate': 'created_by', 'Campaign': 'created_by'}
    models_ = [apps.get_model('broadcasts', n) for n in names]
    for m in models_:
        field = creator[m.__name__]
        for row in m.objects.filter(owner__isnull=True).exclude(**{f'{field}__isnull': True}).only('id', field):
            m.objects.filter(pk=row.pk).update(owner_id=getattr(row, f'{field}_id'))
    if any(m.objects.filter(owner__isnull=True).exists() for m in models_):
        owner = default_owner(apps)
        for m in models_:
            m.objects.filter(owner__isnull=True).update(owner=owner)


class Migration(migrations.Migration):

    dependencies = [
        ('broadcasts', '0004_remove_groups'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name='mediafile', name='owner', field=owner_fk(null=True)),
        migrations.AddField(model_name='messagetemplate', name='owner', field=owner_fk(null=True)),
        migrations.AddField(model_name='campaign', name='owner', field=owner_fk(null=True)),
        migrations.RunPython(assign, migrations.RunPython.noop),
        migrations.AlterField(model_name='mediafile', name='owner', field=owner_fk()),
        migrations.AlterField(model_name='messagetemplate', name='owner', field=owner_fk()),
        migrations.AlterField(model_name='campaign', name='owner', field=owner_fk()),
    ]
