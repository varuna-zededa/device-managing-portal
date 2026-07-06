from django.contrib import admin
from .models import PortalUser


@admin.register(PortalUser)
class PortalUserAdmin(admin.ModelAdmin):
    list_display = ('name', 'email', 'team', 'user_type')
    list_filter = ('team', 'user_type')
