from django.core.management.base import BaseCommand, CommandError
from apps.users.models import PortalUser


class Command(BaseCommand):
    help = 'Create an admin portal user (idempotent — skips if email already exists)'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True, help='Admin email address')
        parser.add_argument('--name', required=True, help='Admin display name')

    def handle(self, *args, **options):
        email = options['email'].strip().lower()
        name = options['name'].strip()

        if not email:
            raise CommandError('--email must not be blank')
        if not name:
            raise CommandError('--name must not be blank')

        user, created = PortalUser.objects.get_or_create(
            email=email,
            defaults={'name': name, 'user_type': 'admin'},
        )

        if created:
            self.stdout.write(self.style.SUCCESS(f'Admin user created: {email}'))
        else:
            self.stdout.write(f'User already exists: {email} (skipped)')
