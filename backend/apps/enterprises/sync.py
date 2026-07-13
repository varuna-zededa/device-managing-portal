import logging

import httpx
from django.utils import timezone

from services.zedcloud import STATUS_MAP, fetch_enterprise_devices
from utils.crypto import decrypt
from utils.email import send_token_expiry_alert

logger = logging.getLogger(__name__)


def _extract_connectivity(net_status_list: list) -> list | None:
    connectivity = []
    for iface in net_status_list:
        if iface.get('up') and iface.get('uplink'):
            mac = iface.get('macAddr', '')
            iface_name = iface.get('ifName', '')
            for ip in iface.get('ipAddrs', []):
                if ip and ':' not in ip:
                    connectivity.append({'ip': ip, 'mac': mac, 'interface_name': iface_name})
    return connectivity or None


def _extract_eve_version(sw_info: list) -> str | None:
    return next(
        (sw['shortVersion'] for sw in sw_info if sw.get('activated')),
        None,
    )


def sync_enterprise(enterprise) -> set[str]:
    """Sync one enterprise. Returns set of seen serial numbers. Raises on failure."""
    from apps.devices.models import Device, UntrackedDevice  # noqa: PLC0415

    bearer_token = decrypt(bytes(enterprise.bearer_token_enc))
    raw_devices = fetch_enterprise_devices(enterprise.cluster.host, bearer_token)
    seen_serials: set[str] = set()
    now = timezone.now()

    for d in raw_devices:
        serial = (
            d.get('minfo', {}).get('serialNumber', '')
            or d.get('hardwareInfo', {}).get('serialNum', '')
        )
        if not serial:
            continue

        seen_serials.add(serial)
        run_state = d.get('runState', 'RUN_STATE_UNKNOWN')
        status_str = STATUS_MAP.get(run_state, 'Unknown')
        eve_version = _extract_eve_version(d.get('swInfo', []))
        connectivity = _extract_connectivity(d.get('netStatusList', []))
        minfo = d.get('minfo', {})
        model_str = f"{minfo.get('manufacturer', '')}-{minfo.get('productName', '')}".strip('-')
        device_name = d.get('name', '')
        zcloud_id = d.get('id', '')

        inventory_device = Device.objects.filter(serial_number=serial).first()
        if inventory_device:
            update_fields = [
                'enterprise', 'cluster', 'cluster_device_name',
                'eve_version', 'device_connectivity', 'status', 'status_fetched_at',
            ]
            inventory_device.enterprise = enterprise
            inventory_device.cluster = enterprise.cluster
            inventory_device.cluster_device_name = device_name
            inventory_device.eve_version = eve_version
            inventory_device.device_connectivity = connectivity
            inventory_device.status = status_str
            inventory_device.status_fetched_at = now
            if inventory_device.condition == 'missing':
                inventory_device.condition = 'normal'
                update_fields.append('condition')
            inventory_device.save(update_fields=update_fields)
        else:
            # Use create_defaults (Django 4.1+) so first_seen_at is only set on creation
            UntrackedDevice.objects.update_or_create(
                serial_number=serial,
                enterprise=enterprise,
                create_defaults={
                    'first_seen_at': now,
                },
                defaults={
                    'zcloud_id': zcloud_id,
                    'name': device_name,
                    'model': model_str,
                    'run_state': run_state,
                    'eve_version': eve_version,
                    'device_connectivity': connectivity,
                    'last_seen_at': now,
                },
            )

    return seen_serials


def sync_all_enterprises() -> None:
    from apps.devices.models import Device  # noqa: PLC0415
    from apps.enterprises.models import Enterprise  # noqa: PLC0415
    from apps.notifications.models import Notification  # noqa: PLC0415

    logger.info('Starting sync_all_enterprises')
    all_seen_serials: set[str] = set()
    failed_enterprise_ids: list[int] = []

    for enterprise in Enterprise.objects.filter(is_active=True).select_related('cluster'):
        try:
            seen = sync_enterprise(enterprise)
            all_seen_serials.update(seen)
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in (401, 403):
                enterprise.last_sync_status = 'token_expired'
                enterprise.last_sync_error = f'HTTP {code}'
                send_token_expiry_alert(enterprise)
                Notification.objects.create(
                    kind='token_expired',
                    title=f'Token expired — {enterprise.name} on {enterprise.cluster.name}',
                    body=(
                        f'Bearer token for enterprise "{enterprise.name}" on cluster '
                        f'"{enterprise.cluster.name}" ({enterprise.cluster.host}) is invalid or expired. '
                        f'Update it in the Clusters & Enterprises tab.'
                    ),
                )
            else:
                enterprise.last_sync_status = 'error'
                enterprise.last_sync_error = f'HTTP {code}'
            logger.warning('ZedCloud HTTP %s for enterprise %s', code, enterprise.name)
            failed_enterprise_ids.append(enterprise.pk)
        except Exception as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = str(exc)
            logger.exception('Sync failed for enterprise %s', enterprise.name)
            failed_enterprise_ids.append(enterprise.pk)
        finally:
            enterprise.last_sync_at = timezone.now()
            enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])

    # Mark MISSING: inventory devices with enterprise assigned, condition=normal, not seen this cycle
    # Exclude failed enterprises to prevent false-missing marks when sync fails mid-cycle
    Device.objects.filter(
        enterprise__isnull=False,
        condition='normal',
    ).exclude(
        enterprise_id__in=failed_enterprise_ids,
    ).exclude(serial_number__in=all_seen_serials).update(condition='missing')

    logger.info('sync_all_enterprises complete. Seen serials: %d', len(all_seen_serials))
