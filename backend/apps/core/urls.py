from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("team", views.TeamViewSet, basename="team")

urlpatterns = [
    path("auth/session/", views.session),
    path("auth/register/", views.register),
    path("auth/login/", views.login_view),
    path("auth/logout/", views.logout_view),
    path("auth/password/", views.change_password),
    path("settings/", views.settings_view),
    path("dashboard/", views.dashboard),
    path("health/", views.health),
    *router.urls,
]
