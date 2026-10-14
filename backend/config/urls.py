from django.contrib import admin
from django.urls import include, path

from apps.broadcasts.views import public_media

admin.site.site_header = "WA Broadcaster admin"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("m/<str:token>/", public_media),
    path("m/<str:token>/<path:name>", public_media),
    path("api/", include("apps.core.urls")),
    path("api/", include("apps.whatsapp.urls")),
    path("api/", include("apps.broadcasts.urls")),
    path("api/", include("apps.contacts.urls")),
]
