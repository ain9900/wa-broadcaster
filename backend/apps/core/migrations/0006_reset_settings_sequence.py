from django.core.management.color import no_style
from django.db import migrations


def reset_sequence(apps, schema_editor):
    """The settings row used to be saved with a forced id of 1, so PostgreSQL's id counter never moved and
    the next user's settings row clashed with it. Point the counter past the existing rows."""
    AppSettings = apps.get_model("core", "AppSettings")
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for sql in connection.ops.sequence_reset_sql(no_style(), [AppSettings]):
            cursor.execute(sql)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_teammember"),
    ]

    operations = [
        migrations.RunPython(reset_sequence, migrations.RunPython.noop),
    ]
