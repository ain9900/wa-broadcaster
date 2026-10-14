import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="appsettings",
            name="default_country_code",
            field=models.CharField(
                blank=True, default="880", max_length=4,
                help_text="Added to local numbers that start with 0 (e.g. 017… becomes 88017…).",
                validators=[django.core.validators.RegexValidator(r"^\d{0,4}$", "Digits only, e.g. 880")],
            ),
        ),
    ]
