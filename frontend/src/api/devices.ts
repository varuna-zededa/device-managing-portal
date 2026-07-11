import client from './client'

export interface Device {
  id: number
  name: string
  serial_number: string
  description: string | null
  cluster_device_name: string | null
  model: { id: number; name: string; customer_partner_name: string | null }
  cluster: { id: number; name: string; host: string } | null
  team: string | null
  owner_email: string | null
  owner_name: string | null
  lab: string
  location_detail: string | null
  condition: string
  idrac_ip: string | null
  idrac_username: string | null
  eve_version: string | null
  device_connectivity: Array<{ ip: string; mac: string; interface_name: string }> | null
  status: string | null
  status_fetched_at: string | null
  reserved_at: string | null
  is_available: boolean
  pending_requester_email: string | null
  pending_requester_name: string | null
  last_purpose_text: string | null
  last_purpose_by: string | null
  last_purpose_at: string | null
  created_at: string
  updated_at: string
}

export interface DevicesQueryParams {
  q?: string
  available?: 'true' | 'false' | 'all'
  team?: string
  lab?: string
  condition?: string
}

export interface DevicePurpose {
  id: number
  device: number
  author_email: string
  author_name?: string
  text: string
  created_at: string
}

export interface OwnershipHistory {
  id: number
  device: number
  owner_email: string | null
  owner_name?: string
  changed_by: string
  changed_at: string
  reason: string
}

export async function getDevices(params: DevicesQueryParams = {}): Promise<Device[]> {
  const res = await client.get('/devices/', { params })
  return res.data
}

export async function createDevice(data: Partial<Device> & Record<string, unknown>): Promise<Device> {
  const res = await client.post('/devices/', data)
  return res.data
}

export async function updateDevice(id: number, data: Partial<Device> & Record<string, unknown>): Promise<Device> {
  const res = await client.put(`/devices/${id}/`, data)
  return res.data
}

export async function deleteDevice(id: number): Promise<void> {
  await client.delete(`/devices/${id}/`)
}

export type ReserveResult = { immediate: true } | { immediate: false; message: string }

export async function reserveDevice(id: number): Promise<ReserveResult> {
  const res = await client.post(`/devices/${id}/reserve/`)
  return res.data?.message
    ? { immediate: false, message: res.data.message }
    : { immediate: true }
}

export async function releaseDevice(id: number): Promise<unknown> {
  const res = await client.post(`/devices/${id}/release/`)
  return res.data
}

export async function forceAssignDevice(id: number, assignee_email: string): Promise<unknown> {
  const res = await client.post(`/devices/${id}/force-assign/`, { assignee_email })
  return res.data
}

export async function fetchDeviceStatus(
  id: number,
  data: { bearer_token?: string; cluster_id?: number; cluster_device_name?: string },
): Promise<Device> {
  const res = await client.post(`/devices/${id}/status/`, data)
  return res.data
}

export async function getDevicePurpose(id: number): Promise<DevicePurpose[]> {
  const res = await client.get(`/devices/${id}/purpose/`)
  return res.data
}

export async function setDevicePurpose(id: number, text: string): Promise<DevicePurpose> {
  const res = await client.post(`/devices/${id}/purpose/`, { text })
  return res.data
}

export async function getOwnershipHistory(id: number): Promise<OwnershipHistory[]> {
  const res = await client.get(`/devices/${id}/ownership-history/`)
  return res.data
}
