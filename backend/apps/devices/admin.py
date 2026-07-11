from django.contrib import admin
from .models import Device, Lab


@admin.register(Lab)
class LabAdmin(admin.ModelAdmin):
    list_display = ('name',)
    search_fields = ('name',)


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ('name', 'serial_number', 'model', 'cluster', 'owner_email', 'lab', 'condition', 'status')
    list_filter = ('lab', 'condition', 'team')
    search_fields = ('name', 'serial_number', 'owner_email')
