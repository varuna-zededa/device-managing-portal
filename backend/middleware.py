import re
import time
import random
import logging
from datetime import timedelta
from django.utils import timezone

logger = logging.getLogger(__name__)

# Matches numeric IDs and hex reservation tokens (32+ hex chars)
_ID_RE = re.compile(r'/\d+(?=/|$)')
_TOKEN_RE = re.compile(r'/[0-9a-f]{32,}(?=/|$)')

_SKIP_PREFIXES = ('/static/', '/admin/', '/favicon')


def _normalize_path(path):
    path = _TOKEN_RE.sub('/{token}', path)
    path = _ID_RE.sub('/{id}', path)
    return path


class LatencyMiddleware:
    RETENTION_DAYS = 30

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if any(request.path.startswith(p) for p in _SKIP_PREFIXES):
            return self.get_response(request)

        start = time.monotonic()
        response = self.get_response(request)
        duration_ms = int((time.monotonic() - start) * 1000)

        try:
            self._record(request.method, request.path, response.status_code, duration_ms)
        except Exception as e:
            logger.warning('LatencyMiddleware failed to record: %s', e)

        return response

    def _record(self, method, path, status_code, duration_ms):
        from apps.admin_tools.models import RequestLog

        normalized = _normalize_path(path)
        RequestLog.objects.create(
            method=method,
            path=normalized,
            status_code=status_code,
            duration_ms=duration_ms,
            timestamp=timezone.now(),
        )

        # Probabilistic pruning: ~1% of requests trigger cleanup
        if random.random() < 0.01:
            cutoff = timezone.now() - timedelta(days=self.RETENTION_DAYS)
            RequestLog.objects.filter(timestamp__lt=cutoff).delete()
