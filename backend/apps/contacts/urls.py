from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("contacts", views.ContactViewSet, basename="contact")
router.register("contact-lists", views.ContactListViewSet, basename="contactlist")

urlpatterns = router.urls
