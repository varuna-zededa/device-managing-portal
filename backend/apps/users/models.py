from django.db import models

TEAM_CHOICES = [('ST', 'ST'), ('EVE', 'EVE'), ('PLATFORM', 'PLATFORM')]
USER_TYPE_CHOICES = [('admin', 'Admin'), ('team_member', 'Team Member')]


class PortalUser(models.Model):
    name = models.CharField(max_length=200)
    email = models.EmailField(unique=True)
    team = models.CharField(max_length=20, choices=TEAM_CHOICES)
    user_type = models.CharField(max_length=20, choices=USER_TYPE_CHOICES, default='team_member')

    def __str__(self):
        return f'{self.name} ({self.email})'
