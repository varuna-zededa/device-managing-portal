from django.db import models

KIND_CHOICES = [
    ('token_expired', 'Token Expired'),
    ('sync_error', 'Sync Error'),
    ('name_mismatch', 'Name Mismatch'),
    ('enterprise_inactive', 'Enterprise Inactive'),
]


class Notification(models.Model):
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    enterprise = models.ForeignKey(
        'enterprises.Enterprise',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    title = models.CharField(max_length=300)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [('kind', 'enterprise')]

    def __str__(self):
        return self.title
