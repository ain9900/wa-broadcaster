from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("accounts", views.AccountViewSet, basename="account")

urlpatterns = [
    path("whatsapp/webhook/", views.webhook),
    *router.urls,
]
