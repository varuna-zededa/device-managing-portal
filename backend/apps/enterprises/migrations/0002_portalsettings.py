from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('enterprises', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='PortalSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sync_interval_minutes', models.PositiveIntegerField(default=60)),
            ],
            options={
                'verbose_name': 'Portal Settings',
            },
        ),
    ]
