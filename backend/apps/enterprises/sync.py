import logging
import re

import httpx
from django.utils import timezone

from services.zedcloud import STATUS_MAP, ENTERPRISE_STATE_ACTIVE, fetch_enterprise_devices, fetch_enterprise_self
from utils.crypto import decrypt
from utils.email import send_token_expiry_alert

logger = logging.getLogger(__name__)

# ── Serial / model filters ────────────────────────────────────────────────────

# Well-known BIOS placeholders and test values that are not real hardware serials.
_SERIAL_BLOCKLIST: frozenset[str] = frozenset({
    '0',
    'unknown',
    'inventory',
    'default string',
    'to be filled by o.e.m.',
    'not specified',
    'not applicable',
    'system serial number',
    'chassis serial number',
    'base board serial number',
    'none',
    'n/a',
    'na',
    'null',
    'tbd',
    'empty',
    '9999998',
    '500600',
    '123456789',
})

# UUID-format serials (QEMU and cloud platforms generate these; not real hardware serials).
_RE_UUID_SERIAL = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8,}$',
    re.IGNORECASE,
)

# VMware VM serial format: "VMware-HH HH HH ... HH-HH HH ..."
_RE_VMWARE_SERIAL = re.compile(r'^VMware-', re.IGNORECASE)

# Model substrings that indicate a virtual or cloud-hosted device.
# Matched case-insensitively; "standard pc (q35" catches Proxmox, FEDORA, and other
# hypervisors that use the QEMU Q35 machine type but a different manufacturer name.
_VIRTUAL_MODEL_KEYWORDS: tuple[str, ...] = (
    'qemu',
    'azure',
    'aws',
    'vmware',
    'virtualbox',
    'kvm virtual',
    'standard pc (q35',
)


def _is_junk_serial(serial: str) -> bool:
    """Return True for well-known placeholder or non-hardware serial numbers."""
    s = serial.strip()
    if not s or s.lower() in _SERIAL_BLOCKLIST:
        return True
    if _RE_UUID_SERIAL.match(s):
        return True
    if _RE_VMWARE_SERIAL.match(s):
        return True
    return False


def _is_virtual_device(model: str) -> bool:
    """Return True if the model string indicates a virtual or cloud-hosted device."""
    m = model.lower()
    return any(kw in m for kw in _VIRTUAL_MODEL_KEYWORDS)


def _purge_invalid_untracked() -> None:
    """Delete UntrackedDevice rows with junk serials or virtual-device models.

    Runs at the start of every sync so stale rows ingested before the filters
    existed (or no longer visible in ZedCloud) are cleaned up automatically.
    """
    from apps.devices.models import UntrackedDevice  # noqa: PLC0415

    bad_pks = [
        d.pk
        for d in UntrackedDevice.objects.only('pk', 'serial_number', 'model')
        if _is_junk_serial(d.serial_number) or _is_virtual_device(d.model or '')
    ]
    if bad_pks:
        deleted, _ = UntrackedDevice.objects.filter(pk__in=bad_pks).delete()
        logger.info('Purged %d invalid UntrackedDevice rows (junk serial or virtual model)', deleted)


# ── Run-state priority ────────────────────────────────────────────────────────

# Priority tier for cross-enterprise conflict resolution (lower number = higher priority).
# When the same device serial appears in multiple enterprises, the enterprise whose
# run state has the lowest tier number wins and its data is written to the Device row.
# First-seen breaks ties within the same tier.
# RUN_STATE_UNPROVISIONED is absent — those devices are rejected at intake.
_RUN_STATE_TIER: dict[str, int] = {
    'RUN_STATE_ONLINE': 1,
    'RUN_STATE_PREPARING_POWEROFF': 1,
    'RUN_STATE_PREPARED_POWEROFF': 1,
    'RUN_STATE_REBOOTING': 2,
    'RUN_STATE_BOOTING': 2,
    'RUN_STATE_BASEOS_UPDATING': 2,
    'RUN_STATE_MAINTENANCE_MODE': 2,
    'RUN_STATE_POWERING_OFF': 3,
    'RUN_STATE_OFFLINE': 4,
    'RUN_STATE_SUSPECT': 5,
}
_SKIPPED_STATES = {'RUN_STATE_UNPROVISIONED', 'RUN_STATE_PROVISIONED'}
_SUSPECT_STATE = 'RUN_STATE_SUSPECT'
_FALLBACK_TIER = 99  # unrecognised states lose to everything in the table


def _run_state_tier(run_state: str) -> int:
    return _RUN_STATE_TIER.get(run_state, _FALLBACK_TIER)


class TokenDecryptError(Exception):
    pass


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
        (sw.get('shortVersion') for sw in sw_info if sw.get('activated')),
        None,
    )


def _apply_inventory_candidate(candidate: dict, now) -> None:
    """Write a candidate to an inventory Device row.

    Used by single-enterprise sync paths (manual trigger, post-token-rotation).
    Cross-enterprise conflict resolution happens before this call in sync_all_enterprises.
    """
    device = candidate['device']

    # SUSPECT data is unreliable — mirror sync_all_enterprises behaviour: only set
    # needs_repair to alert the admin; never overwrite enterprise/cluster/status with
    # data from a SUSPECT device.  This prevents a single-enterprise manual sync from
    # clobbering a device's cluster assignment when it is healthy in another enterprise.
    if candidate['run_state'] == _SUSPECT_STATE:
        if device.condition == 'normal':
            device.condition = 'needs_repair'
            device.save(update_fields=['condition'])
        return

    update_fields = ['enterprise', 'cluster', 'eve_version', 'device_connectivity', 'status', 'status_fetched_at']
    device.enterprise = candidate['enterprise']
    device.cluster = candidate['cluster']
    if candidate['cluster_device_name']:
        device.cluster_device_name = candidate['cluster_device_name']
        update_fields.append('cluster_device_name')
    device.eve_version = candidate['eve_version']
    device.device_connectivity = candidate['device_connectivity']
    device.status = candidate['status']
    device.status_fetched_at = now
    # Clear sync-owned condition flags when device is healthy and reachable again.
    # Both 'missing' and 'needs_repair' are sync-managed; admin-set conditions
    # (out_of_order, dedicated, temporarily_leased) are never touched.
    if device.condition in ('missing', 'needs_repair'):
        device.condition = 'normal'
        update_fields.append('condition')
    device.save(update_fields=update_fields)


def _emit_token_expired(enterprise) -> None:
    """Create (dedup) a token_expired notification and send the alert email if new."""
    from apps.notifications.models import Notification  # noqa: PLC0415
    _, created = Notification.objects.get_or_create(
        kind='token_expired',
        enterprise=enterprise,
        defaults={
            'is_read': False,
            'title': f'Token expired — {enterprise.name} on {enterprise.cluster.name}',
            'body': (
                f'Bearer token for enterprise "{enterprise.name}" on cluster '
                f'"{enterprise.cluster.name}" ({enterprise.cluster.host}) is invalid or expired. '
                f'Update it in the Clusters & Enterprises tab.'
            ),
        },
    )
    if created:
        send_token_expiry_alert(enterprise)


def sync_enterprise(enterprise) -> tuple[set[str], list[dict]]:
    """
    Fetch and process device data for one enterprise. Raises on failure.

    Returns:
      seen_serials   — every serial returned by ZedCloud, excluding UNPROVISIONED
      candidates     — pending update dicts for inventory (Device) matches; callers
                       apply these after cross-enterprise conflict resolution.
                       UntrackedDevice rows are written inline (keyed per
                       serial+enterprise, so no cross-enterprise conflict is possible).
    """
    from apps.devices.models import Device, UntrackedDevice  # noqa: PLC0415

    _purge_invalid_untracked()

    try:
        bearer_token = decrypt(bytes(enterprise.bearer_token_enc))
    except Exception as exc:
        raise TokenDecryptError(f'Cannot decrypt bearer token for {enterprise.name}') from exc

    raw_devices = fetch_enterprise_devices(enterprise.cluster.host, bearer_token)
    seen_serials: set[str] = set()
    serials_in_inventory: set[str] = set()
    candidates: list[dict] = []
    now = timezone.now()

    # First pass: collect eligible (serial, raw_device) pairs.
    # Filters applied here (earliest possible) so rejected serials are excluded from
    # seen_serials, candidates, UntrackedDevice, and the missing-mark entirely.
    eligible: list[tuple[str, dict]] = []
    junk_serials: set[str] = set()       # for bulk cleanup of pre-existing UntrackedDevice rows
    for d in raw_devices:
        serial = (
            d.get('minfo', {}).get('serialNumber', '')
            or d.get('hardwareInfo', {}).get('serialNum', '')
        )
        if not serial:
            continue
        # UNPROVISIONED and PROVISIONED devices have not completed bootstrap and carry
        # no useful operational data. Exclude them entirely — not added to seen_serials,
        # candidates, or UntrackedDevice, and they don't affect the missing-mark.
        if d.get('runState', 'RUN_STATE_UNKNOWN') in _SKIPPED_STATES:
            continue
        # Reject well-known placeholder/junk serial numbers and virtual-machine identifiers.
        if _is_junk_serial(serial):
            junk_serials.add(serial)
            continue
        eligible.append((serial, d))

    # Single bulk query to check which serials exist in inventory.
    inventory_by_serial: dict[str, Device] = {
        dev.serial_number: dev
        for dev in Device.objects.filter(serial_number__in=[s for s, _ in eligible])
    }

    virtual_serials: set[str] = set()     # for bulk cleanup of pre-existing UntrackedDevice rows

    for serial, d in eligible:
        run_state = d.get('runState', 'RUN_STATE_UNKNOWN')
        seen_serials.add(serial)
        status_str = STATUS_MAP.get(run_state, 'Unknown')
        eve_version = _extract_eve_version(d.get('swInfo', []))
        connectivity = _extract_connectivity(d.get('netStatusList', []))
        minfo = d.get('minfo', {})
        model_str = f"{minfo.get('manufacturer', '')}-{minfo.get('productName', '')}".strip('-')
        device_name = d.get('name')
        zcloud_id = d.get('id', '')

        inventory_device = inventory_by_serial.get(serial)
        if inventory_device:
            serials_in_inventory.add(serial)
            candidates.append({
                'device': inventory_device,
                'serial': serial,
                'enterprise': enterprise,
                'cluster': enterprise.cluster,
                'cluster_device_name': device_name or None,
                'eve_version': eve_version,
                'device_connectivity': connectivity,
                'status': status_str,
                'run_state': run_state,
            })
        else:
            # Reject virtual/cloud devices from untracked — we only track physical hardware.
            # We still allow inventory devices with virtual models to receive status updates
            # (they were manually curated), so this check lives only in the untracked branch.
            if _is_virtual_device(model_str):
                virtual_serials.add(serial)
                continue
            # create_defaults supplies ALL fields for INSERT; defaults is UPDATE-only.
            # first_seen_at is in create_defaults only so it is never overwritten.
            _untracked_fields = {
                'zcloud_id': zcloud_id,
                'name': device_name or '',
                'model': model_str,
                'run_state': run_state,
                'eve_version': eve_version,
                'device_connectivity': connectivity,
                'last_seen_at': now,
            }
            UntrackedDevice.objects.update_or_create(
                serial_number=serial,
                enterprise=enterprise,
                create_defaults={'first_seen_at': now, **_untracked_fields},
                defaults=_untracked_fields,
            )

    # Bulk-delete UntrackedDevice rows that are no longer eligible:
    # - serials now matched to inventory (promoted or manually added)
    # - junk/placeholder serials we started filtering this cycle
    # - serials whose model was identified as a virtual/cloud device
    stale_serials = serials_in_inventory | junk_serials | virtual_serials
    if stale_serials:
        UntrackedDevice.objects.filter(
            serial_number__in=stale_serials, enterprise=enterprise,
        ).delete()

    return seen_serials, candidates


def apply_candidates(candidates: list[dict], now) -> None:
    """
    Apply candidates directly with no cross-enterprise conflict resolution.
    Used by single-enterprise sync paths (EnterpriseSyncView, post-token-rotation sync).
    """
    for c in candidates:
        _apply_inventory_candidate(c, now)


def sync_all_enterprises() -> None:
    from apps.devices.models import Device  # noqa: PLC0415
    from apps.enterprises.models import Enterprise  # noqa: PLC0415
    from apps.notifications.models import Notification  # noqa: PLC0415

    logger.info('Starting sync_all_enterprises')
    all_seen_serials: set[str] = set()
    # Enterprises excluded from the missing-mark: failed syncs, zero-device responses,
    # and token_expired enterprises (skipped entirely — known-bad token, no data this cycle).
    exclude_from_missing: list[int] = []
    # Best candidate per serial after tier-based conflict resolution.
    best_candidates: dict[str, dict] = {}

    for enterprise in Enterprise.objects.filter(is_active=True).select_related('cluster'):
        # Skip enterprises with a known-bad token — a sync attempt would 401 immediately.
        # Exclude their devices from the missing-mark to prevent false positives.
        if enterprise.last_sync_status == 'token_expired':
            exclude_from_missing.append(enterprise.pk)
            continue

        sync_ok = False
        candidates: list[dict] = []
        try:
            seen, candidates = sync_enterprise(enterprise)
            all_seen_serials.update(seen)
            if not seen:
                exclude_from_missing.append(enterprise.pk)
            enterprise.last_sync_status = 'ok'
            enterprise.last_sync_error = None
            Notification.objects.filter(kind='token_expired', enterprise=enterprise).delete()
            sync_ok = True
        except TokenDecryptError as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = 'Bearer token cannot be decrypted — re-enter it'
            logger.warning('Cannot decrypt token for enterprise %s: %s', enterprise.name, exc)
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code in (401, 403):
                enterprise.last_sync_status = 'token_expired'
                enterprise.last_sync_error = f'HTTP {code}'
                # Dedup: one notification per (kind, enterprise) pair.
                _emit_token_expired(enterprise)
            else:
                enterprise.last_sync_status = 'error'
                enterprise.last_sync_error = f'HTTP {code}'
            logger.warning('ZedCloud HTTP %s for enterprise %s', code, enterprise.name)
            exclude_from_missing.append(enterprise.pk)
        except Exception as exc:
            enterprise.last_sync_status = 'error'
            enterprise.last_sync_error = str(exc)
            logger.exception('Sync failed for enterprise %s', enterprise.name)
            exclude_from_missing.append(enterprise.pk)
        finally:
            enterprise.last_sync_at = timezone.now()
            enterprise.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_error'])

        if not sync_ok:
            continue

        # Tier-based conflict resolution: lower tier number = higher priority.
        # First-seen wins within the same tier.
        for c in candidates:
            serial = c['serial']
            if serial not in best_candidates:
                best_candidates[serial] = c
            elif _run_state_tier(c['run_state']) < _run_state_tier(best_candidates[serial]['run_state']):
                best_candidates[serial] = c

    # Apply inventory updates after ALL enterprises have been processed.
    # Only now can we determine the true winning state for each serial.
    now = timezone.now()
    for serial, candidate in best_candidates.items():
        if candidate['run_state'] == _SUSPECT_STATE:
            # Best available state across every enterprise is SUSPECT — data is unreliable.
            # Skip updating device fields; mark needs_repair so the admin knows to investigate.
            Device.objects.filter(serial_number=serial, condition='normal').update(condition='needs_repair')
            logger.info('Marked %s as needs_repair — best available run state is SUSPECT', serial)
        else:
            _apply_inventory_candidate(candidate, now)

    # Mark MISSING: inventory devices with an enterprise assigned, condition=normal, not
    # seen in this sync cycle. Enterprises that failed or returned zero devices are excluded
    # to prevent false-missing marks.
    Device.objects.filter(
        enterprise__isnull=False,
        condition='normal',
    ).exclude(
        enterprise_id__in=exclude_from_missing,
    ).exclude(serial_number__in=all_seen_serials).update(condition='missing')

    logger.info('sync_all_enterprises complete. Seen serials: %d', len(all_seen_serials))


def verify_enterprise_names() -> None:
    """Post-import trigger: for any enterprise not yet name-verified, call ZedCloud and notify on mismatch."""
    import json
    from apps.notifications.models import Notification
    from .models import Enterprise

    enterprises = (
        Enterprise.objects
        .filter(is_active=True, name_verified=False)
        .select_related('cluster')
    )

    for enterprise in enterprises:
        try:
            bearer_token = decrypt(bytes(enterprise.bearer_token_enc))
        except Exception:
            logger.warning('verify_enterprise_names: cannot decrypt token for %s — skipping', enterprise.name)
            continue

        try:
            info = fetch_enterprise_self(enterprise.cluster.host, bearer_token)
        except Exception as exc:
            logger.warning('verify_enterprise_names: ZedCloud call failed for %s: %s — skipping', enterprise.name, exc)
            continue

        update_fields = []

        if info['zcloud_id'] and info['zcloud_id'] != enterprise.zcloud_id:
            enterprise.zcloud_id = info['zcloud_id']
            update_fields.append('zcloud_id')

        if info['state'] != ENTERPRISE_STATE_ACTIVE:
            Notification.objects.get_or_create(
                kind='enterprise_inactive',
                enterprise=enterprise,
                defaults={
                    'is_read': False,
                    'title': f'Enterprise inactive in ZedCloud — {enterprise.name}',
                    'body': (
                        f'Enterprise "{enterprise.name}" on cluster "{enterprise.cluster.name}" '
                        f'has state "{info["state_label"]}" in ZedCloud. '
                        f'It has been deactivated in Holocron. Re-activate it once the ZedCloud state is resolved.'
                    ),
                },
            )
            enterprise.is_active = False
            update_fields.append('is_active')
            logger.info(
                'verify_enterprise_names: enterprise %s is not active in ZedCloud (state=%s) — deactivated',
                enterprise.name, info['state'],
            )
        elif info['name'] and info['name'] != enterprise.name:
            Notification.objects.get_or_create(
                kind='name_mismatch',
                enterprise=enterprise,
                defaults={
                    'is_read': False,
                    'title': f'Enterprise name mismatch — {enterprise.cluster.name}',
                    'body': json.dumps({'local_name': enterprise.name, 'zcloud_name': info['name']}),
                },
            )
            logger.info(
                'verify_enterprise_names: name mismatch for %s (local=%r zcloud=%r)',
                enterprise.name, enterprise.name, info['name'],
            )
        else:
            # State active and name confirmed (matches, or ZedCloud returned no name to compare)
            enterprise.name_verified = True
            update_fields.append('name_verified')

        if update_fields:
            enterprise.save(update_fields=update_fields)
