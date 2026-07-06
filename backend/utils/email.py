import logging
from django.core.mail import send_mail
from django.conf import settings
from apps.users.models import PortalUser

logger = logging.getLogger(__name__)


def _send(subject, body, recipients):
    if not recipients:
        return
    if not getattr(settings, 'EMAIL_HOST', ''):
        return
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients, fail_silently=True)
    except Exception as e:
        logger.debug(str(e))


def send_reservation_request(device, requester, owner, token):
    requester_name = requester.name if hasattr(requester, 'name') else str(requester)
    owner_email = owner.email if hasattr(owner, 'email') else str(owner)
    base_url = getattr(settings, 'PORTAL_BASE_URL', 'http://localhost:80').rstrip('/')
    confirm_url = f'{base_url}/confirm/{token}'
    subject = f'[Device Portal] Reservation request for {device.name}'
    body = (
        f'{requester_name} has requested to reserve device "{device.name}".\n\n'
        f'Review and approve or reject the request here:\n{confirm_url}\n\n'
        f'This request expires in 3 hours.'
    )
    _send(subject, body, [owner_email])


def send_reservation_approved(device, requester_email):
    subject = f'[Device Portal] Your request for {device.name} was approved'
    body = f'Your reservation request for device "{device.name}" has been approved. The device is now yours.'
    _send(subject, body, [requester_email])


def send_reservation_rejected(device, requester_email):
    subject = f'[Device Portal] Your request for {device.name} was rejected'
    body = f'Your reservation request for device "{device.name}" has been rejected.'
    _send(subject, body, [requester_email])


def send_force_assign_notice(device, displaced_owner_email, assignee_name):
    subject = f'[Device Portal] Device {device.name} was reassigned'
    body = (
        f'Device "{device.name}" has been force-assigned to {assignee_name} by an admin.\n'
        f'You are no longer the owner of this device.'
    )
    _send(subject, body, [displaced_owner_email])


def send_out_of_order_alert(device):
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    subject = f'[Device Portal] Device out of order: {device.name}'
    cluster_name = device.cluster.name if device.cluster else '—'
    location = f'{device.lab}'
    if device.location_detail:
        location += f', {device.location_detail}'
    eve = device.eve_version or '—'
    body = (
        f'Device "{device.name}" has been marked as Out of Order.\n\n'
        f'Model:      {device.model.name if device.model else "—"}\n'
        f'Lab:        {location}\n'
        f'IDRAC IP:   {device.idrac_ip or "—"}\n'
        f'Cluster:    {cluster_name}\n'
        f'EVE version:{eve}\n'
    )
    _send(subject, body, admin_emails)


def send_reservation_overridden(device, requester_email):
    subject = f'[Device Portal] Your request for {device.name} was cancelled'
    body = (
        f'Your pending reservation request for device "{device.name}" has been cancelled '
        f'because an admin force-assigned the device to another user.'
    )
    _send(subject, body, [requester_email])
