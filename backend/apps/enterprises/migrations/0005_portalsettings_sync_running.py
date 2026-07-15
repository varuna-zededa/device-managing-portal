from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('enterprises', '0004_portalsettings_last_sync_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='portalsettings',
            name='sync_running',
            field=models.BooleanField(default=False),
        ),
    ]
