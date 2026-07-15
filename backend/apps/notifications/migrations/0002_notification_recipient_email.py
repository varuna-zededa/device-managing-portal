from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='recipient_email',
            field=models.EmailField(blank=True, db_index=True, null=True),
        ),
    ]
