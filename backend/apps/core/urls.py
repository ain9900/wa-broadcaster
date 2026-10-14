from django.urls import path

from . import views

urlpatterns = [
    path("auth/session/", views.session),
    path("auth/login/", views.login_view),
    path("auth/logout/", views.logout_view),
    path("auth/password/", views.change_password),
    path("settings/", views.settings_view),
    path("dashboard/", views.dashboard),
    path("health/", views.health),
]
