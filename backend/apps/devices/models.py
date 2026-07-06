from django.db import models

LAB_CHOICES = [
    ('Bangalore Lab', 'Bangalore Lab'),
    ('Bangalore Office Space', 'Bangalore Office Space'),
    ('Berlin Lab', 'Berlin Lab'),
    ('SanJose Lab', 'SanJose Lab'),
    ('CoreSite Lab', 'CoreSite Lab'),
    ('Home Lab', 'Home Lab'),
]

CONDITION_CHOICES = [
    ('normal', 'Normal'),
    ('out_of_order', 'Out of Order'),
    ('needs_repair', 'Needs Repair'),
    ('temporarily_leased', 'Temporarily Leased'),
    ('dedicated', 'Dedicated'),
]


class Device(models.Model):
    name = models.CharField(max_length=200)
    serial_number = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True, null=True)
    cluster_device_name = models.CharField(max_length=200, blank=True, null=True)
    model = models.ForeignKey('device_models.DeviceModel', on_delete=models.PROTECT)
    cluster = models.ForeignKey('clusters.Cluster', on_delete=models.SET_NULL, null=True, blank=True)
    team = models.CharField(max_length=20, blank=True, null=True)
    owner_email = models.CharField(max_length=200, blank=True, null=True)
    lab = models.CharField(max_length=50, choices=LAB_CHOICES)
    location_detail = models.CharField(max_length=500, blank=True, null=True)
    condition = models.CharField(max_length=20, choices=CONDITION_CHOICES, default='normal')
    idrac_ip = models.CharField(max_length=100, blank=True, null=True)
    idrac_username = models.CharField(max_length=100, blank=True, null=True)
    idrac_password_enc = models.BinaryField(blank=True, null=True)
    eve_version = models.CharField(max_length=200, blank=True, null=True)
    device_connectivity = models.JSONField(blank=True, null=True)
    status = models.CharField(max_length=50, blank=True, null=True)
    last_comment_text = models.TextField(blank=True, null=True)
    last_comment_by = models.CharField(max_length=200, blank=True, null=True)
    last_comment_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    @property
    def is_available(self):
        return (
            self.owner_email is None
            and self.condition not in ('out_of_order', 'temporarily_leased', 'dedicated')
        )
