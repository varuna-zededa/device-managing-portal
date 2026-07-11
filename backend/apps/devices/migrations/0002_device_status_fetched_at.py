from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='device',
            name='status_fetched_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
