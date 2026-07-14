from django.db import migrations, models


def migrate_condition_forward(apps, schema_editor):
    Device = apps.get_model('devices', 'Device')
    Device.objects.filter(admin_condition='missing').update(
        sync_condition='missing',
        admin_condition='normal',
    )
    Device.objects.filter(admin_condition='needs_repair').update(
        sync_condition='needs_recovery',
        admin_condition='normal',
    )


def migrate_condition_backward(apps, schema_editor):
    Device = apps.get_model('devices', 'Device')
    Device.objects.filter(sync_condition='needs_recovery').update(
        admin_condition='needs_repair',
        sync_condition=None,
    )
    Device.objects.filter(sync_condition='missing').update(
        admin_condition='missing',
        sync_condition=None,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0001_initial'),
    ]

    operations = [
        # 1. Rename column — preserves all existing values.
        migrations.RenameField(
            model_name='device',
            old_name='condition',
            new_name='admin_condition',
        ),

        # 2. Drop the old constraint before narrowing the choices.
        migrations.RemoveConstraint(
            model_name='device',
            name='device_condition_valid',
        ),

        # 3. Temporarily widen choices so the RunPython step can filter by old values.
        migrations.AlterField(
            model_name='device',
            name='admin_condition',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('normal', 'Normal'),
                    ('out_of_order', 'Out of Order'),
                    ('temporarily_leased', 'Temporarily Leased'),
                    ('dedicated', 'Dedicated'),
                    ('needs_repair', 'Needs Repair'),
                    ('missing', 'Missing'),
                ],
                default='normal',
            ),
        ),

        # 4. Add the new nullable sync_condition column.
        migrations.AddField(
            model_name='device',
            name='sync_condition',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('missing', 'Missing'),
                    ('needs_recovery', 'Needs Recovery'),
                ],
                null=True,
                blank=True,
            ),
        ),

        # 5. Move sync-owned values from admin_condition to sync_condition.
        migrations.RunPython(
            migrate_condition_forward,
            reverse_code=migrate_condition_backward,
        ),

        # 6. Tighten admin_condition to its final valid set.
        migrations.AlterField(
            model_name='device',
            name='admin_condition',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('normal', 'Normal'),
                    ('out_of_order', 'Out of Order'),
                    ('temporarily_leased', 'Temporarily Leased'),
                    ('dedicated', 'Dedicated'),
                ],
                default='normal',
            ),
        ),

        # 7. Add the two new constraints.
        migrations.AddConstraint(
            model_name='device',
            constraint=models.CheckConstraint(
                condition=models.Q(admin_condition__in=[
                    'normal', 'out_of_order', 'temporarily_leased', 'dedicated',
                ]),
                name='device_admin_condition_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='device',
            constraint=models.CheckConstraint(
                condition=models.Q(sync_condition__isnull=True) | models.Q(sync_condition__in=[
                    'missing', 'needs_recovery',
                ]),
                name='device_sync_condition_valid',
            ),
        ),
    ]
