import django.db.models.deletion
from django.db import migrations, models


def populate_user_team(apps, schema_editor):
    PortalUser = apps.get_model('users', 'PortalUser')
    Team = apps.get_model('users', 'Team')

    team_cache = {team.name: team for team in Team.objects.all()}

    for user in PortalUser.objects.all():
        team_name = user.team_str or ''
        if team_name and team_name in team_cache:
            PortalUser.objects.filter(pk=user.pk).update(team=team_cache[team_name])


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_rename_team_member_to_member'),
    ]

    operations = [
        # Step 1 — rename old CharField out of the way
        migrations.RenameField('portaluser', 'team', 'team_str'),

        # Step 2 — add nullable FK
        migrations.AddField(
            model_name='portaluser',
            name='team',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='members',
                to='users.team',
            ),
        ),

        # Step 3 — populate FK from old string column
        migrations.RunPython(populate_user_team, migrations.RunPython.noop),

        # Step 4 — make non-nullable
        migrations.AlterField(
            model_name='portaluser',
            name='team',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='members',
                to='users.team',
            ),
        ),

        # Step 5 — remove old string column
        migrations.RemoveField('portaluser', 'team_str'),
    ]
