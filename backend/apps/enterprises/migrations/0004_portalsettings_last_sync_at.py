from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('enterprises', '0003_add_last_sync_error_code'),
    ]

    operations = [
        migrations.AddField(
            model_name='portalsettings',
            name='last_sync_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
