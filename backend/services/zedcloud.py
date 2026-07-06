import logging
import httpx

logger = logging.getLogger(__name__)

STATUS_MAP = {
    'RUN_STATE_ONLINE': 'Online',
    'RUN_STATE_OFFLINE': 'Offline',
    'RUN_STATE_HALTING': 'Halting',
    'RUN_STATE_SUSPENDED': 'Suspended',
    'RUN_STATE_UNKNOWN': 'Unknown',
}


class SerialMismatchError(Exception):
    def __init__(self, expected, actual):
        self.expected = expected
        self.actual = actual
        super().__init__(f'Serial mismatch: expected={expected}, actual={actual}')


def fetch_device_status(cluster, cluster_device_name, bearer_token, device):
    url = f'https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info'
    headers = {'Authorization': f'Bearer {bearer_token}'}

    response = httpx.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    data = response.json()

    actual_serial = data.get('hardwareInfo', {}).get('serialNum', '')
    if actual_serial and actual_serial != device.serial_number:
        raise SerialMismatchError(expected=device.serial_number, actual=actual_serial)

    eve_version = next(
        (sw['shortVersion'] for sw in data.get('swInfo', []) if sw.get('activated')),
        None,
    )

    connectivity = []
    for iface in data.get('netStatusList', []):
        if iface.get('up') and iface.get('uplink'):
            mac = iface.get('macAddr', '')
            name = iface.get('name', '')
            for ip in iface.get('ipAddrs', []):
                if ip and ':' not in ip:
                    connectivity.append({
                        'ip': ip,
                        'mac': mac,
                        'interface_name': name,
                    })

    run_state = data.get('runState', 'RUN_STATE_UNKNOWN')
    dev_status = STATUS_MAP.get(run_state, 'Unknown')

    return eve_version, connectivity if connectivity else None, dev_status
