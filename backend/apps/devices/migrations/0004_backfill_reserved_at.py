from django.db import migrations


def backfill_reserved_at(apps, schema_editor):
    Device = apps.get_model('devices', 'Device')
    OwnershipHistory = apps.get_model('reservations', 'OwnershipHistory')

    for device in Device.objects.filter(owner_email__isnull=False, reserved_at__isnull=True):
        history = (
            OwnershipHistory.objects
            .filter(device=device, owner_email=device.owner_email)
            .order_by('-changed_at')
            .first()
        )
        if history:
            device.reserved_at = history.changed_at
            device.save(update_fields=['reserved_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0003_device_reserved_at'),
        ('reservations', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(backfill_reserved_at, migrations.RunPython.noop),
    ]
