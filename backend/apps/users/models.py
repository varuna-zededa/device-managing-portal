from django.db import models

USER_TYPE_CHOICES = [('admin', 'Admin'), ('team_member', 'Team Member')]


class Team(models.Model):
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class PortalUser(models.Model):
    name = models.CharField(max_length=200)
    email = models.EmailField(unique=True)
    team = models.CharField(max_length=50)
    user_type = models.CharField(max_length=20, choices=USER_TYPE_CHOICES, default='team_member')

    def __str__(self):
        return f'{self.name} ({self.email})'
