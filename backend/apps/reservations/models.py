from django.db import models

STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
    ('expired', 'Expired'),
]


class ReservationRequest(models.Model):
    device = models.ForeignKey('devices.Device', on_delete=models.CASCADE)
    requester_email = models.CharField(max_length=200)
    requested_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    token = models.CharField(max_length=64, unique=True)

    def __str__(self):
        return f'{self.device} <- {self.requester_email}'


class DeviceComment(models.Model):
    device = models.ForeignKey('devices.Device', on_delete=models.CASCADE)
    author_email = models.CharField(max_length=200)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.device} by {self.author_email}'


class OwnershipHistory(models.Model):
    REASON_CHOICES = [
        ('device_added', 'Device Added'),
        ('reserved', 'Reserved'),
        ('released', 'Released'),
        ('force_assigned', 'Force Assigned'),
        ('request_approved', 'Request Approved'),
        ('request_expired', 'Request Expired'),
        ('condition_change', 'Condition Change'),
    ]
    device = models.ForeignKey('devices.Device', on_delete=models.CASCADE)
    owner_email = models.CharField(max_length=200, blank=True, null=True)
    changed_by = models.CharField(max_length=200)
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.CharField(max_length=30, choices=REASON_CHOICES)

    def __str__(self):
        return f'{self.device} -> {self.owner_email} ({self.reason})'
