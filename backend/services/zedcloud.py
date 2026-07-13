import logging
import httpx

logger = logging.getLogger(__name__)

_client = httpx.Client(timeout=30)

# Source: libs/zmsg/zcommon/zcommon.proto — enum RunState, device-applicable values only
STATUS_MAP = {
    'RUN_STATE_ONLINE': 'Online',                           # 1
    'RUN_STATE_HALTED': 'Halted',                           # 2
    'RUN_STATE_REBOOTING': 'Rebooting',                     # 4
    'RUN_STATE_OFFLINE': 'Offline',                         # 5
    'RUN_STATE_UNKNOWN': 'Unknown',                         # 6
    'RUN_STATE_UNPROVISIONED': 'Unprovisioned',             # 7
    'RUN_STATE_PROVISIONED': 'Provisioned',                 # 8
    'RUN_STATE_SUSPECT': 'Suspect',                         # 9
    'RUN_STATE_DOWNLOADING': 'Downloading',                 # 10
    'RUN_STATE_RESTARTING': 'Restarting',                   # 11
    'RUN_STATE_BOOTING': 'Booting',                         # 18
    'RUN_STATE_MAINTENANCE_MODE': 'Maintenance',            # 19
    'RUN_STATE_BASEOS_UPDATING': 'BaseOS Updating',         # 21
    'RUN_STATE_PREPARING_POWEROFF': 'Preparing Poweroff',   # 22
    'RUN_STATE_POWERING_OFF': 'Powering Off',               # 23
    'RUN_STATE_PREPARED_POWEROFF': 'Prepared Poweroff',     # 24
}


class SerialMismatchError(Exception):
    def __init__(self, expected: str, actual: str) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(f'Serial mismatch: expected={expected}, actual={actual}')


def fetch_device_status(
    cluster,
    cluster_device_name: str,
    bearer_token: str,
    device,
) -> tuple[str | None, list | None, str]:
    url = f'https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info'
    headers = {'Authorization': f'Bearer {bearer_token}'}

    response = _client.get(url, headers=headers)
    response.raise_for_status()

    data = response.json()

    actual_serial = (
        data.get('minfo', {}).get('serialNumber', '')
        or data.get('hardwareInfo', {}).get('serialNum', '')
    )
    if actual_serial and actual_serial != device.serial_number:
        raise SerialMismatchError(expected=device.serial_number, actual=actual_serial)

    eve_version: str | None = next(
        (sw['shortVersion'] for sw in data.get('swInfo', []) if sw.get('activated')),
        None,
    )

    connectivity: list = []
    for iface in data.get('netStatusList', []):
        if iface.get('up') and iface.get('uplink'):
            mac = iface.get('macAddr', '')
            name = iface.get('ifName', '')
            for ip in iface.get('ipAddrs', []):
                if ip and ':' not in ip:
                    connectivity.append({
                        'ip': ip,
                        'mac': mac,
                        'interface_name': name,
                    })

    run_state = data.get('runState', 'RUN_STATE_UNKNOWN')
    dev_status: str = STATUS_MAP.get(run_state, 'Unknown')

    return eve_version, connectivity if connectivity else None, dev_status


ENTERPRISE_STATE_ACTIVE = 'ENTERPRISE_STATE_ACTIVE'

_ENTERPRISE_STATE_LABELS: dict[str, str] = {
    'ENTERPRISE_STATE_UNSPECIFIED': 'Unspecified',
    'ENTERPRISE_STATE_CREATED': 'Created (not yet active)',
    'ENTERPRISE_STATE_DELETED': 'Deleted',
    'ENTERPRISE_STATE_ACTIVE': 'Active',
    'ENTERPRISE_STATE_INACTIVE': 'Inactive / Suspended',
    'ENTERPRISE_STATE_SIGNEDUP': 'Signed up (onboarding)',
}


def fetch_enterprise_self(host: str, bearer_token: str) -> dict:
    """Call /v1/enterprises/self. Returns {name, zcloud_id, state, state_label}."""
    url = f'https://{host}/v1/enterprises/self'
    headers = {'Authorization': f'Bearer {bearer_token}'}
    response = _client.get(url, headers=headers)
    response.raise_for_status()
    data = response.json()
    state = data.get('state', '').strip()
    return {
        'name': data.get('name', '').strip(),
        'zcloud_id': data.get('id', '').strip(),
        'state': state,
        'state_label': _ENTERPRISE_STATE_LABELS.get(state, state),
    }


def fetch_enterprise_devices(host: str, bearer_token: str) -> list[dict]:
    """Paginate GET /v1/devices/status and return all device records."""
    headers = {'Authorization': f'Bearer {bearer_token}'}
    all_devices: list[dict] = []
    page_num = 1
    while True:
        url = f'https://{host}/v1/devices/status?next.pageSize=200&next.pageNum={page_num}'
        response = _client.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        all_devices.extend(data.get('list', []))
        total_pages = data.get('next', {}).get('totalPages', 1)
        if page_num >= total_pages:
            break
        page_num += 1
    return all_devices
