from django.db import models


class DeviceModel(models.Model):
    name = models.CharField(max_length=200, unique=True)
    customer_partner_name = models.CharField(max_length=200, blank=True, null=True)

    def __str__(self):
        return self.name
