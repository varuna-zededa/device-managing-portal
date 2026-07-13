import client from './client'

export interface UntrackedDevice {
  id: number
  enterprise: number
  enterprise_name: string
  cluster_name: string
  cluster_host: string
  zcloud_id: string
  name: string
  serial_number: string
  model: string
  run_state: string
  eve_version: string | null
  device_connectivity: Array<{ ip: string; mac: string; interface_name: string }> | null
  first_seen_at: string
  last_seen_at: string
}

export interface UntrackedFilters {
  enterprise?: string
  cluster?: string
  serial_number?: string
}

export async function getUntrackedDevices(filters: UntrackedFilters = {}): Promise<UntrackedDevice[]> {
  const res = await client.get('/untracked-devices/', { params: filters })
  return res.data
}

export async function moveToInventory(
  id: number,
  data: { lab: string; model: number },
): Promise<unknown> {
  const res = await client.post(`/untracked-devices/${id}/move-to-inventory/`, data)
  return res.data
}
