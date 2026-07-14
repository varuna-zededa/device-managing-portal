from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('enterprises', '0003_enterprise_zcloud_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='enterprise',
            name='zcloud_username',
            field=models.CharField(blank=True, default='', max_length=254),
        ),
    ]
