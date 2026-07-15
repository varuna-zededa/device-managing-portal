from django.contrib import admin
from .models import Enterprise


@admin.register(Enterprise)
class EnterpriseAdmin(admin.ModelAdmin):
    list_display = ('name', 'cluster', 'is_active', 'last_sync_status', 'last_sync_at')
    list_filter = ('is_active', 'last_sync_status', 'cluster')
    readonly_fields = ('bearer_token_enc', 'last_sync_at', 'last_sync_status', 'last_sync_error', 'last_sync_error_code')
