import environ
import logging.handlers
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('SECRET_KEY')
ENCRYPTION_KEY = env('ENCRYPTION_KEY')
DEBUG = env.bool('DEBUG', default=False)
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['*'])

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'apps.clusters',
    'apps.device_models',
    'apps.devices',
    'apps.users',
    'apps.reservations',
    'apps.admin_tools',
    'apps.enterprises',
    'apps.notifications',
]

MIDDLEWARE = [
    'middleware.RequestIDMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'middleware.LatencyMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'data' / 'db.sqlite3',
    }
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'static'

FIXTURE_DIRS = [BASE_DIR / 'fixtures']

EMAIL_HOST = env('SMTP_HOST', default='')
EMAIL_PORT = env.int('SMTP_PORT', default=587)
EMAIL_HOST_USER = env('SMTP_USER', default='')
EMAIL_HOST_PASSWORD = env('SMTP_PASS', default='')
DEFAULT_FROM_EMAIL = env('SMTP_FROM', default='device-portal@zededa.com')
EMAIL_USE_TLS = True
if not EMAIL_HOST:
    EMAIL_BACKEND = 'django.core.mail.backends.dummy.EmailBackend'

PORTAL_BASE_URL = env('PORTAL_BASE_URL', default='http://localhost:80')

DEVICE_LIST_REFRESH_MS = env.int('DEVICE_LIST_REFRESH_MS', default=300_000)   # 5 min
NOTIFICATION_REFRESH_MS = env.int('NOTIFICATION_REFRESH_MS', default=30_000)  # 30 sec

if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=[])
CORS_ALLOW_HEADERS = list(__import__('corsheaders.defaults', fromlist=['default_headers']).default_headers) + ['x-user-email']

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': [],
}

# ── Email alerts for 500 errors ───────────────────────────────────────────────
_admin_emails = env.list('ADMIN_EMAILS', default=[])
ADMINS = [('Portal Admin', e) for e in _admin_emails]
SERVER_EMAIL = env('SERVER_EMAIL', default=DEFAULT_FROM_EMAIL)

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL = env('LOG_LEVEL', default='INFO')
# Default resolves to backend/logs/ locally and /app/logs/ inside Docker
# (BASE_DIR is /app inside the container when settings.py is at /app/config/settings.py)
LOG_DIR = env('LOG_DIR', default=str(BASE_DIR / 'logs'))

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'filters': {
        'request_id': {
            '()': 'utils.log_filters.RequestIDFilter',
        },
    },
    'formatters': {
        'standard': {
            'format': '{asctime} {levelname:<8} [{request_id}] {name}: {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'standard',
            'filters': ['request_id'],
        },
        'file': {
            'class': 'logging.handlers.TimedRotatingFileHandler',
            'filename': f'{LOG_DIR}/portal.log',
            'when': 'midnight',
            'interval': 1,
            'backupCount': 30,
            'encoding': 'utf-8',
            'formatter': 'standard',
            'filters': ['request_id'],
        },
    },
    # Third-party libraries: WARNING and above only
    'root': {
        'handlers': ['console', 'file'],
        'level': 'WARNING',
    },
    'loggers': {
        # Django's own request logger — captures 500 tracebacks
        'django.request': {
            'handlers': ['console', 'file'],
            'level': 'ERROR',
            'propagate': False,
        },
        # Portal source namespaces — controlled by LOG_LEVEL env var
        'apps': {
            'handlers': ['console', 'file'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
        'services': {
            'handlers': ['console', 'file'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
        'middleware': {
            'handlers': ['console', 'file'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
        'utils': {
            'handlers': ['console', 'file'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
    },
}
