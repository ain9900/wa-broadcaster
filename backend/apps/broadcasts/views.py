import mimetypes
import secrets

from django.core.files.base import ContentFile

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core.csvutil import csv_response
from apps.core.workspace import WorkspaceMixin

from .fetch import FetchError, fetch
from .models import Campaign, CampaignTarget, MediaFile, MessageTemplate
from .reports import TARGET_HEADER, target_rows
from .serializers import (
    CampaignCreateSerializer, CampaignDetailSerializer, CampaignListSerializer,
    MediaFileSerializer, TemplateSerializer,
)

S, T = Campaign.Status, CampaignTarget.Status


class TemplateViewSet(WorkspaceMixin, viewsets.ModelViewSet):
    serializer_class = TemplateSerializer
    pagination_class = None

    def get_queryset(self):
        return MessageTemplate.objects.filter(owner=self.workspace)

    def perform_create(self, serializer):
        serializer.save(owner=self.workspace, created_by=self.request.user)


class MediaViewSet(WorkspaceMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = MediaFileSerializer
    parser_classes = [MultiPartParser]

    def get_queryset(self):
        return MediaFile.objects.filter(owner=self.workspace)

    def create(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "Choose a file to upload."}, status=status.HTTP_400_BAD_REQUEST)
        if f.size == 0:
            return Response({"error": "The file is empty."}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
            return Response({"error": f"Files can be up to {settings.MAX_UPLOAD_MB} MB."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        name = (f.name or "file").replace("\\", "_").replace("/", "_")[:200]
        mime = (f.content_type or "").split(";")[0].strip().lower()
        if not mime or mime == "application/octet-stream":
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        m = MediaFile.objects.create(owner=self.workspace, file=f, original_name=name, mime_type=mime[:120], size=f.size,
                                     uploaded_by=request.user)
        return Response(MediaFileSerializer(m, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="from-url", parser_classes=[JSONParser])
    def from_url(self, request):
        """Attach a file by link, e.g. https://yourdomain.com/banner.jpg. The server downloads it."""
        url = str(request.data.get("url") or "").strip()[:1000]
        if not url:
            return Response({"error": "Paste a link first."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            got = fetch(url)
        except FetchError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        m = MediaFile(owner=self.workspace, original_name=got.filename, mime_type=got.mime_type[:120], size=len(got.data),
                      uploaded_by=request.user, source_url=got.url[:1000])
        m.file.save(got.filename, ContentFile(got.data), save=False)
        m.save()
        return Response(MediaFileSerializer(m, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="public", parser_classes=[JSONParser])
    def public(self, request, pk=None):
        """{"public": true} gives the file a public link on your domain; false turns the link off."""
        m = self.get_object()
        if request.data.get("public", True):
            if not m.public_token:
                m.public_token = secrets.token_urlsafe(18)
                m.save(update_fields=["public_token"])
        elif m.public_token:
            m.public_token = None
            m.save(update_fields=["public_token"])
        return Response(MediaFileSerializer(m, context={"request": request}).data)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        m = self.get_object()
        try:
            fh = m.file.open("rb")
        except FileNotFoundError:
            raise Http404
        resp = FileResponse(fh, content_type=m.mime_type, filename=m.original_name)
        resp["Content-Disposition"] = resp["Content-Disposition"].replace("attachment", "inline")
        resp["Cache-Control"] = "private, max-age=3600"
        return resp


PUBLIC_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"


@api_view(["GET", "HEAD"])
@authentication_classes([])
@permission_classes([AllowAny])
def public_media(request, token, name=""):
    """Serve a file that was given a public link. Anyone with the link can open it."""
    m = MediaFile.objects.filter(public_token=token).first()
    if not m:
        raise Http404
    try:
        fh = m.file.open("rb")
    except FileNotFoundError:
        raise Http404
    inline = m.safe_inline
    resp = FileResponse(fh, content_type=m.mime_type if inline else "application/octet-stream",
                        filename=m.original_name, as_attachment=not inline)
    resp["Cache-Control"] = "public, max-age=86400"
    resp["Content-Security-Policy"] = PUBLIC_CSP
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Access-Control-Allow-Origin"] = "*"
    return resp


def with_counts(qs):
    return qs.annotate(
        total=Count("targets"),
        sent=Count("targets", filter=Q(targets__status=T.SENT)),
        failed=Count("targets", filter=Q(targets__status=T.FAILED)),
        skipped=Count("targets", filter=Q(targets__status=T.SKIPPED)),
        pending=Count("targets", filter=Q(targets__status__in=[T.PENDING, T.SENDING])),
    )


class CampaignViewSet(WorkspaceMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                      mixins.DestroyModelMixin, viewsets.GenericViewSet):
    def get_queryset(self):
        qs = with_counts(Campaign.objects.filter(owner=self.workspace)
                         .select_related("media", "created_by").prefetch_related("sender_accounts")
                         .order_by("-created_at", "-id"))  # Meta.ordering is dropped on grouped (count) queries
        st = self.request.query_params.get("status")
        if st == "active":
            qs = qs.filter(status__in=Campaign.ACTIVE)
        elif st:
            qs = qs.filter(status=st)
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(message__icontains=q))
        if self.action == "retrieve":
            qs = qs.prefetch_related("targets")
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return CampaignCreateSerializer
        return CampaignDetailSerializer if self.action == "retrieve" else CampaignListSerializer

    def create(self, request):
        s = CampaignCreateSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            campaign = s.save()
        return Response(self.detail_data(campaign.pk), status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        c = self.get_object()
        if c.status in Campaign.ACTIVE:
            return Response({"error": "Cancel this send before deleting it."}, status=status.HTTP_409_CONFLICT)
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def detail_data(self, pk):
        return CampaignDetailSerializer(with_counts(Campaign.objects.select_related("media").prefetch_related("sender_accounts")).get(pk=pk),
                                        context={"request": self.request}).data

    def transition(self, pk, allowed, **changes):
        c = self.get_object()
        n = Campaign.objects.filter(pk=c.pk, status__in=allowed).update(**changes)
        if not n:
            return None
        return c

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        with transaction.atomic():
            c = self.transition(pk, Campaign.ACTIVE, status=S.CANCELLED, finished_at=timezone.now(), next_action_at=None, note="")
            if not c:
                return Response({"error": "This send has already finished."}, status=status.HTTP_409_CONFLICT)
            c.targets.filter(status=T.PENDING).update(status=T.SKIPPED, error="Cancelled", finished_at=timezone.now())
        return Response(self.detail_data(c.pk))

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        c = self.transition(pk, [S.SCHEDULED, S.RUNNING], status=S.PAUSED, next_action_at=None, note="Paused")
        if not c:
            return Response({"error": "Only a waiting or running send can be paused."}, status=status.HTTP_409_CONFLICT)
        return Response(self.detail_data(c.pk))

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        c = self.get_object()
        when = max(c.scheduled_at, timezone.now()) if c.started_at is None else timezone.now()
        if not self.transition(pk, [S.PAUSED], status=S.SCHEDULED, scheduled_at=when, note=""):
            return Response({"error": "Only a paused send can be resumed."}, status=status.HTTP_409_CONFLICT)
        return Response(self.detail_data(c.pk))

    @action(detail=True, methods=["post"], url_path="retry-failed")
    def retry_failed(self, request, pk=None):
        """New send with the same message to every recipient that failed or was skipped."""
        src = self.get_object()
        redo = list(src.targets.filter(status__in=[T.FAILED, T.SKIPPED]))
        if not redo:
            return Response({"error": "Nothing failed or was skipped in this send."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            fields = ["message", "media", "delay_min_seconds", "delay_max_seconds", "batch_size", "batch_pause_minutes",
                      "typing_indicator", "rotation_mode", "rotate_every", "failover"]
            c = Campaign.objects.create(
                name=f"Retry: {src.name}"[:120], owner=src.owner, created_by=request.user, scheduled_at=timezone.now(),
                **{f: getattr(src, f) for f in fields},
            )
            c.sender_accounts.set(src.sender_accounts.all())
            CampaignTarget.objects.bulk_create([
                CampaignTarget(campaign=c, account=None, account_label="",
                               contact_id=t.contact_id, recipient_jid=t.recipient_jid, recipient_name=t.recipient_name, position=i)
                for i, t in enumerate(redo)
            ])
        return Response(self.detail_data(c.pk), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """Every recipient of this campaign with its result, as CSV."""
        c = self.get_object()
        return csv_response(f"campaign-{c.pk}-report.csv", TARGET_HEADER, target_rows(c.targets.all()))
