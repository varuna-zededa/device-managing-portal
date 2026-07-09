from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0002_device_status_fetched_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='device',
            name='reserved_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
