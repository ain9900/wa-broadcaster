from django.contrib.auth import get_user_model


def me():
    """The signed-in test user (the `user` fixture), who owns the records tests create directly."""
    return get_user_model().objects.get_or_create(username="admin")[0]
