from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('enterprises', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='enterprise',
            name='name_verified',
            field=models.BooleanField(default=False),
        ),
    ]
