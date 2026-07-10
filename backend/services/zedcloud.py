import logging
import httpx

logger = logging.getLogger(__name__)

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

    actual_serial = (
        data.get('minfo', {}).get('serialNumber', '')
        or data.get('hardwareInfo', {}).get('serialNum', '')
    )
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
            name = iface.get('ifName', '')
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
