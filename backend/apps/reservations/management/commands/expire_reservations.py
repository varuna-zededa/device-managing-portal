from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.reservations.models import ReservationRequest


class Command(BaseCommand):
    help = 'Mark all pending reservation requests that have passed their expiry time as expired.'

    def handle(self, *args, **options):
        now = timezone.now()
        expired = ReservationRequest.objects.filter(status='pending', expires_at__lt=now)
        count = expired.update(status='expired')
        self.stdout.write(f'Expired {count} reservation request(s).')
