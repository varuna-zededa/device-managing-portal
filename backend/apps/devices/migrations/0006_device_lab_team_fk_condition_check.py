import django.db.models
import django.db.models.deletion
from django.db import migrations, models


def populate_device_fks(apps, schema_editor):
    Device = apps.get_model('devices', 'Device')
    Lab = apps.get_model('devices', 'Lab')
    Team = apps.get_model('users', 'Team')

    lab_cache = {lab.name: lab for lab in Lab.objects.all()}
    team_cache = {team.name: team for team in Team.objects.all()}

    # Migrate lab — create Lab row if the string doesn't match any existing lab
    for device in Device.objects.all():
        lab_name = device.lab_str or ''
        if lab_name:
            if lab_name not in lab_cache:
                lab = Lab(name=lab_name)
                lab.save()
                lab_cache[lab_name] = lab
            Device.objects.filter(pk=device.pk).update(lab=lab_cache[lab_name])

    # Migrate team — null if no matching Team row
    for device in Device.objects.all():
        team_name = device.team_str or ''
        if team_name and team_name in team_cache:
            Device.objects.filter(pk=device.pk).update(team=team_cache[team_name])


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0005_lab_alter_device_condition_alter_device_lab'),
        ('users', '0002_team_alter_portaluser_team'),
    ]

    operations = [
        # Step 1 — rename old string fields out of the way
        migrations.RenameField('device', 'lab', 'lab_str'),
        migrations.RenameField('device', 'team', 'team_str'),

        # Step 2 — add new FK columns (nullable initially so existing rows are valid)
        migrations.AddField(
            model_name='device',
            name='lab',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='devices',
                to='devices.lab',
            ),
        ),
        migrations.AddField(
            model_name='device',
            name='team',
            field=models.ForeignKey(
                null=True, blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='devices',
                to='users.team',
            ),
        ),

        # Step 3 — populate FKs from the old string columns
        migrations.RunPython(populate_device_fks, migrations.RunPython.noop),

        # Step 4 — make lab non-nullable now that every row has a value
        migrations.AlterField(
            model_name='device',
            name='lab',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='devices',
                to='devices.lab',
            ),
        ),

        # Step 5 — remove old string columns
        migrations.RemoveField('device', 'lab_str'),
        migrations.RemoveField('device', 'team_str'),

        # Step 6 — add condition CHECK constraint
        migrations.AddConstraint(
            model_name='device',
            constraint=models.CheckConstraint(
                condition=models.Q(condition__in=[
                    'normal', 'out_of_order', 'needs_repair',
                    'temporarily_leased', 'dedicated', 'missing',
                ]),
                name='device_condition_valid',
            ),
        ),
    ]
