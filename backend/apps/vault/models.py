from django.db import models


class Vault(models.Model):
    user_email = models.CharField(max_length=200)
    cluster = models.ForeignKey('clusters.Cluster', on_delete=models.CASCADE)
    bearer_token_enc = models.BinaryField()

    class Meta:
        unique_together = ('user_email', 'cluster')

    def __str__(self):
        return f'{self.user_email} / {self.cluster}'
