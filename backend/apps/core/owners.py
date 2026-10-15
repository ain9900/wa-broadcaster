"""Used by the migrations that gave every record an owner: existing rows go to the first admin."""
from django.conf import settings


def default_owner(apps):
    """The first superuser (or first user). If there are no users yet, an "admin" placeholder with no
    usable password is made; `manage.py ensure_admin` then gives it ADMIN_PASSWORD."""
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    user = User.objects.filter(is_superuser=True).order_by("id").first() or User.objects.order_by("id").first()
    if user is None:
        user = User.objects.create(username="admin", password="!", is_superuser=True, is_staff=True)
    return user


def assign_owner(app_label, *model_names, field="owner"):
    """A RunPython function that gives every row without an owner to default_owner()."""

    def run(apps, schema_editor):
        models = [apps.get_model(app_label, name) for name in model_names]
        if not any(m.objects.filter(**{f"{field}__isnull": True}).exists() for m in models):
            return  # fresh database: nothing to hand over, and no placeholder user needed
        owner = default_owner(apps)
        for m in models:
            m.objects.filter(**{f"{field}__isnull": True}).update(**{field: owner})

    return run
