from functools import lru_cache
from urllib.parse import urlencode

from django.conf import settings

from .base import BaseProvider, Media, ProviderError, SessionState, WebhookEvent

__all__ = ["get_provider", "BaseProvider", "Media", "ProviderError", "SessionState", "WebhookEvent"]


def webhook_secret() -> str:
    return settings.EVOLUTION_API_KEY if settings.WA_PROVIDER == "evolution" else settings.GATEWAY_API_KEY


@lru_cache(maxsize=1)
def get_provider() -> BaseProvider:
    sep = "&" if "?" in settings.WEBHOOK_URL else "?"
    hook = settings.WEBHOOK_URL + sep + urlencode({"token": webhook_secret()})
    if settings.WA_PROVIDER == "evolution":
        from .evolution import EvolutionProvider

        return EvolutionProvider(settings.EVOLUTION_URL, settings.EVOLUTION_API_KEY, hook)
    from .builtin import BuiltinProvider

    return BuiltinProvider(settings.GATEWAY_URL, settings.GATEWAY_API_KEY, hook)
