from django.db import models

SYNC_STATUS_CHOICES = [
    ('ok', 'OK'),
    ('error', 'Error'),
    ('token_expired', 'Token Expired'),
]


class Enterprise(models.Model):
    name = models.CharField(max_length=200)
    cluster = models.ForeignKey(
        'clusters.Cluster', on_delete=models.CASCADE, related_name='enterprises',
    )
    bearer_token_enc = models.BinaryField()
    zcloud_id = models.CharField(max_length=100, blank=True, default='')
    is_active = models.BooleanField(default=True)
    name_verified = models.BooleanField(default=False)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(
        max_length=20, choices=SYNC_STATUS_CHOICES, null=True, blank=True,
    )
    last_sync_error = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ('name', 'cluster')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.cluster.name})'
