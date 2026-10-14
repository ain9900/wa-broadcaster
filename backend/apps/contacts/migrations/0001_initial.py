from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="ContactList",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="Contact",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("phone", models.CharField(help_text="International digits, no +. e.g. 8801712345678", max_length=16, unique=True)),
                ("name", models.CharField(blank=True, max_length=120)),
                ("opted_out", models.BooleanField(default=False, help_text="Never send to this number.")),
                ("on_whatsapp", models.BooleanField(help_text="Result of the last check. Null = not checked yet.", null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("lists", models.ManyToManyField(blank=True, related_name="contacts", to="contacts.contactlist")),
            ],
            options={"ordering": ["name", "phone"]},
        ),
    ]
