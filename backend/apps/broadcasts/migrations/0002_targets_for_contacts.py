import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Campaign targets can now be single contacts as well as groups."""

    dependencies = [
        ("broadcasts", "0001_initial"),
        ("contacts", "0001_initial"),
    ]

    operations = [
        migrations.RenameField("campaigntarget", "group_jid", "recipient_jid"),
        migrations.RenameField("campaigntarget", "group_name", "recipient_name"),
        migrations.AlterField(
            model_name="campaigntarget", name="recipient_name", field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="campaigntarget",
            name="kind",
            field=models.CharField(choices=[("group", "Group"), ("contact", "Contact")], default="group", max_length=10),
        ),
        migrations.AddField(
            model_name="campaigntarget",
            name="contact",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="campaign_targets", to="contacts.contact",
            ),
        ),
    ]
