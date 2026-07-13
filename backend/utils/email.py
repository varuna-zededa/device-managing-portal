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
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients, fail_silently=False)
    except Exception as e:
        logger.warning('Failed to send email to %s: %s', recipients, e)


def send_reservation_request(device, requester, owner, token):
    requester_name = requester.name if hasattr(requester, 'name') else str(requester)
    owner_email = owner.email if hasattr(owner, 'email') else str(owner)
    base_url = getattr(settings, 'PORTAL_BASE_URL', 'http://localhost:80').rstrip('/')
    confirm_url = f'{base_url}/confirm/{token}'
    subject = f'[Holocron] Reservation request for {device.name}'
    body = (
        f'{requester_name} has requested to reserve device "{device.name}".\n\n'
        f'Review and approve or reject the request here:\n{confirm_url}\n\n'
        f'This request expires in 3 hours.'
    )
    _send(subject, body, [owner_email])


def send_reservation_approved(device, requester_email):
    subject = f'[Holocron] Your request for {device.name} was approved'
    body = f'Your reservation request for device "{device.name}" has been approved. The device is now yours.'
    _send(subject, body, [requester_email])


def send_reservation_rejected(device, requester_email):
    subject = f'[Holocron] Your request for {device.name} was rejected'
    body = f'Your reservation request for device "{device.name}" has been rejected.'
    _send(subject, body, [requester_email])


def send_force_assign_notice(device, displaced_owner_email, assignee_name):
    subject = f'[Holocron] Device {device.name} was reassigned'
    body = (
        f'Device "{device.name}" has been force-assigned to {assignee_name} by an admin.\n'
        f'You are no longer the owner of this device.'
    )
    _send(subject, body, [displaced_owner_email])


def send_out_of_order_alert(device):
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    subject = f'[Holocron] Device out of order: {device.name}'
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
    subject = f'[Holocron] Your request for {device.name} was cancelled'
    body = (
        f'Your pending reservation request for device "{device.name}" has been cancelled '
        f'because an admin force-assigned the device to another user.'
    )
    _send(subject, body, [requester_email])


def send_token_expiry_alert(enterprise):
    from django.utils import timezone
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    subject = f'[Holocron] Token expired — {enterprise.name} on {enterprise.cluster.name}'
    body = (
        f'The bearer token for enterprise "{enterprise.name}" on cluster '
        f'"{enterprise.cluster.name}" ({enterprise.cluster.host}) is invalid or expired.\n\n'
        f'Failure detected at: {timezone.now().strftime("%Y-%m-%d %H:%M UTC")}\n\n'
        f'Update the token in the Clusters & Enterprises tab.'
    )
    _send(subject, body, admin_emails)


def send_nightly_digest():
    from apps.devices.models import Device
    from apps.enterprises.models import Enterprise
    admin_emails = list(
        PortalUser.objects.filter(user_type='admin').values_list('email', flat=True)
    )
    if not admin_emails:
        return

    missing_devices = list(Device.objects.filter(condition='missing').select_related('cluster', 'enterprise'))
    out_of_order_devices = list(Device.objects.filter(condition='out_of_order'))
    problem_enterprises = list(
        Enterprise.objects.filter(last_sync_status__in=['error', 'token_expired']).select_related('cluster')
    )

    if not missing_devices and not out_of_order_devices and not problem_enterprises:
        return

    lines = ['[Holocron] Nightly Digest\n']

    if missing_devices:
        lines.append(f'--- Missing Devices ({len(missing_devices)}) ---')
        for d in missing_devices:
            cluster = d.cluster.name if d.cluster else '—'
            ent = d.enterprise.name if d.enterprise else '—'
            lines.append(f'  {d.name}  serial={d.serial_number}  cluster={cluster}  enterprise={ent}')
        lines.append('')

    if out_of_order_devices:
        lines.append(f'--- Out of Order Devices ({len(out_of_order_devices)}) ---')
        for d in out_of_order_devices:
            lines.append(f'  {d.name}  serial={d.serial_number}')
        lines.append('')

    if problem_enterprises:
        lines.append(f'--- Enterprises with Errors ({len(problem_enterprises)}) ---')
        for e in problem_enterprises:
            lines.append(f'  {e.name} on {e.cluster.name}  status={e.last_sync_status}  error={e.last_sync_error or "—"}')
        lines.append('')

    _send('[Holocron] Nightly Digest', '\n'.join(lines), admin_emails)
