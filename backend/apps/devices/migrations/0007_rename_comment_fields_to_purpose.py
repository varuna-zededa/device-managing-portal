from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0006_device_lab_team_fk_condition_check'),
        ('reservations', '0002_rename_devicecomment_to_devicepurpose'),
    ]

    operations = [
        migrations.RenameField('Device', 'last_comment_text', 'last_purpose_text'),
        migrations.RenameField('Device', 'last_comment_by',   'last_purpose_by'),
        migrations.RenameField('Device', 'last_comment_at',   'last_purpose_at'),
    ]
