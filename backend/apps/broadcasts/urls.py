from django.urls import path
from rest_framework.routers import DefaultRouter

from . import reports, views

router = DefaultRouter(trailing_slash=True)
router.register("templates", views.TemplateViewSet, basename="template")
router.register("media", views.MediaViewSet, basename="media")
router.register("campaigns", views.CampaignViewSet, basename="campaign")

urlpatterns = [
    path("reports/", reports.summary),
    path("reports/export/", reports.export),
    *router.urls,
]
