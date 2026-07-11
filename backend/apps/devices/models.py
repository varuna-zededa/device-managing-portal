from django.db import models

CONDITION_CHOICES = [
    ('normal', 'Normal'),
    ('out_of_order', 'Out of Order'),
    ('needs_repair', 'Needs Repair'),
    ('temporarily_leased', 'Temporarily Leased'),
    ('dedicated', 'Dedicated'),
    ('missing', 'Missing'),
]


class Lab(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Device(models.Model):
    name = models.CharField(max_length=200)
    serial_number = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True, null=True)
    cluster_device_name = models.CharField(max_length=200, blank=True, null=True)
    model = models.ForeignKey('device_models.DeviceModel', on_delete=models.PROTECT)
    cluster = models.ForeignKey('clusters.Cluster', on_delete=models.SET_NULL, null=True, blank=True)
    team = models.ForeignKey(
        'users.Team', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='devices',
    )
    owner_email = models.CharField(max_length=200, blank=True, null=True)
    lab = models.ForeignKey(
        'devices.Lab', on_delete=models.PROTECT, related_name='devices',
    )
    location_detail = models.CharField(max_length=500, blank=True, null=True)
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default='normal')
    idrac_ip = models.CharField(max_length=100, blank=True, null=True)
    idrac_username = models.CharField(max_length=100, blank=True, null=True)
    idrac_password_enc = models.BinaryField(blank=True, null=True)
    eve_version = models.CharField(max_length=200, blank=True, null=True)
    device_connectivity = models.JSONField(blank=True, null=True)
    status = models.CharField(max_length=50, blank=True, null=True)
    status_fetched_at = models.DateTimeField(blank=True, null=True)
    reserved_at = models.DateTimeField(blank=True, null=True)
    last_purpose_text = models.TextField(blank=True, null=True)
    last_purpose_by = models.CharField(max_length=200, blank=True, null=True)
    last_purpose_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(condition__in=[
                    'normal', 'out_of_order', 'needs_repair',
                    'temporarily_leased', 'dedicated', 'missing',
                ]),
                name='device_condition_valid',
            )
        ]

    def save(self, *args, **kwargs):
        if not self.owner_email:
            self.owner_email = None
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

    @property
    def is_available(self):
        return (
            not self.owner_email
            and self.condition not in ('out_of_order', 'temporarily_leased', 'dedicated', 'missing')
        )
