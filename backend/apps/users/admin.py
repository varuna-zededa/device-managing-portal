from django.contrib import admin
from .models import PortalUser, Team


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name',)
    search_fields = ('name',)


@admin.register(PortalUser)
class PortalUserAdmin(admin.ModelAdmin):
    list_display = ('name', 'email', 'team', 'user_type')
    list_filter = ('team', 'user_type')
