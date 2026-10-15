"""Django settings. Every deploy-specific value comes from environment variables (see ../.env.example)."""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent
load_dotenv(ROOT_DIR / ".env")


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return str(env(name, str(default))).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [x.strip() for x in str(env(name, default)).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY") or ("dev-insecure-key" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("Set DJANGO_SECRET_KEY in .env (see .env.example).")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.core",
    "apps.whatsapp",
    "apps.contacts",
    "apps.broadcasts",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# SQLite when DATABASE_URL is unset (quick local runs); PostgreSQL in Docker / on the VPS.
DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL") or f"sqlite:///{(BASE_DIR / 'db.sqlite3').as_posix()}",
        conn_max_age=60,
    )
}
if DATABASES["default"]["ENGINE"].endswith("sqlite3"):
    DATABASES["default"].setdefault("OPTIONS", {})["timeout"] = 20

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = Path(env("STATIC_ROOT", BASE_DIR / "staticfiles"))
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", BASE_DIR / "media"))
MAX_UPLOAD_MB = int(env("MAX_UPLOAD_MB", "25"))
# Let anyone who can open the site create their own account (and empty workspace) from the sign-in page.
ALLOW_SIGNUP = env_bool("ALLOW_SIGNUP", False)
# Base of public file links, e.g. https://wa.yourdomain.com (empty = the address the site was opened on).
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "").rstrip("/")
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# ---------- security ----------
SECURE = env_bool("DJANGO_SECURE", False)  # true once served over HTTPS
SESSION_COOKIE_NAME = "wab_session"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = SECURE
CSRF_COOKIE_SECURE = SECURE
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
if SECURE:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30

# ---------- API ----------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_RATES": {"login": "10/min"},
    # How many reverse proxies sit in front of Django. Decides which X-Forwarded-For entry is the
    # real client IP for login throttling (0 = trust none). Docker: 1. Docker + host Nginx: 2.
    "NUM_PROXIES": int(env("NUM_PROXIES", "0")),
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}
if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ["rest_framework.renderers.JSONRenderer"]

# ---------- cache (login throttling, locks) ----------
REDIS_URL = env("REDIS_URL", "")
if REDIS_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# ---------- Celery ----------
# Without REDIS_URL (no Docker), run `python manage.py run_worker` instead of Celery.
CELERY_BROKER_URL = REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
CELERY_TIMEZONE = TIME_ZONE
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_ACKS_LATE = False
CELERY_BEAT_SCHEDULE = {
    "dispatch-due-campaigns": {"task": "broadcasts.dispatch_due_campaigns", "schedule": timedelta(seconds=5)},
    "cleanup-unused-media": {"task": "broadcasts.cleanup_unused_media", "schedule": timedelta(hours=6)},
    "validate-numbers": {"task": "contacts.validate_pending", "schedule": timedelta(seconds=15)},
}

# ---------- WhatsApp provider ----------
WA_PROVIDER = env("WA_PROVIDER", "builtin")  # builtin | evolution
GATEWAY_URL = env("GATEWAY_URL", "http://127.0.0.1:3100").rstrip("/")
GATEWAY_API_KEY = env("GATEWAY_API_KEY", "")
EVOLUTION_URL = env("EVOLUTION_URL", "http://127.0.0.1:8080").rstrip("/")
EVOLUTION_API_KEY = env("EVOLUTION_API_KEY", "")
# Public URL the provider calls back on (Docker: http://backend:8000/api/whatsapp/webhook/)
WEBHOOK_URL = env("WEBHOOK_URL", "http://127.0.0.1:8000/api/whatsapp/webhook/")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {"django.server": {"level": "WARNING"}},
}
