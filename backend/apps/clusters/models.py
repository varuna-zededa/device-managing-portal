from django.db import models


class Cluster(models.Model):
    name = models.CharField(max_length=100, unique=True)
    host = models.CharField(max_length=255)

    def __str__(self):
        return self.name
