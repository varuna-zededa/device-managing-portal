import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
        ('enterprises', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='enterprise',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='notifications',
                to='enterprises.enterprise',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='notification',
            unique_together={('kind', 'enterprise')},
        ),
    ]
