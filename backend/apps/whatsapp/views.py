import hmac

from django.conf import settings
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.broadcasts.limits import sent_today_by_account
from apps.core.models import AppSettings
from apps.core.workspace import WorkspaceMixin

from . import services
from .models import WhatsAppAccount
from .providers import ProviderError, get_provider, webhook_secret
from .serializers import AccountSerializer


def provider_error(e):
    return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class AccountViewSet(WorkspaceMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                     mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AccountSerializer
    pagination_class = None

    def get_queryset(self):
        return WhatsAppAccount.objects.filter(owner=self.workspace)

    def context_for(self, live=None):
        return {
            "request": self.request,
            "live": live or {},
            "sent_today": sent_today_by_account(),
            "workspace_limit": AppSettings.load(self.workspace).daily_limit,
        }

    def list(self, request):
        accounts = list(self.get_queryset())
        live, online = services.refresh_all(accounts)
        data = AccountSerializer(accounts, many=True, context=self.context_for(live)).data
        return Response({"provider": settings.WA_PROVIDER, "provider_online": online, "results": data})

    def respond(self, account, state=None):
        live = {account.id: state} if state else {}
        return Response(AccountSerializer(account, context=self.context_for(live)).data)

    def create(self, request):
        s = AccountSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        account = s.save(owner=self.workspace, provider=settings.WA_PROVIDER, status=WhatsAppAccount.Status.STARTING)
        try:
            state = get_provider().start_session(account.session_id)
        except ProviderError as e:
            account.status, account.last_error = WhatsAppAccount.Status.ERROR, str(e)[:300]
            account.save()
            return provider_error(e)
        services.apply_state(account, state)
        return self.respond(account, state)

    def destroy(self, request, pk=None):
        account = self.get_object()
        try:
            get_provider().delete_session(account.session_id)
        except ProviderError as e:
            if not request.query_params.get("force"):
                return provider_error(f"{e} Use “Remove anyway” to delete it from this app only.")
        account.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def relink(self, request, pk=None):
        account = self.get_object()
        try:
            state = get_provider().restart_session(account.session_id)
        except ProviderError as e:
            return provider_error(e)
        services.apply_state(account, state)
        return self.respond(account, state)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def webhook(request):
    """Connection events pushed by the WhatsApp provider."""
    given = request.headers.get("X-Api-Key") or request.query_params.get("token") or ""
    secret = webhook_secret()
    if not secret or not hmac.compare_digest(given, secret):
        return Response({"error": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
    payload = request.data if isinstance(request.data, dict) else {}
    return Response({"handled": services.handle_webhook(payload)})
