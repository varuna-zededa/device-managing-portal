from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('enterprises', '0002_enterprise_name_verified'),
    ]

    operations = [
        migrations.AddField(
            model_name='enterprise',
            name='zcloud_id',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]
