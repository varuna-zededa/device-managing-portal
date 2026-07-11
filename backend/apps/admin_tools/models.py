from django.db import models


class RequestLog(models.Model):
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=300, db_index=True)
    status_code = models.PositiveSmallIntegerField()
    duration_ms = models.PositiveIntegerField()
    timestamp = models.DateTimeField(db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['path', 'timestamp']),
        ]
