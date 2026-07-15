import client from './client'

export interface Enterprise {
  id: number
  name: string
  cluster: number
  cluster_name: string
  is_active: boolean
  zcloud_id: string
  zcloud_username: string
  name_verified: boolean
  last_sync_at: string | null
  last_sync_status: 'ok' | 'error' | 'token_expired' | null
  last_sync_error: string | null
  last_sync_error_code: number | null
}

export interface ClusterWithEnterprises {
  id: number
  name: string
  host: string
  enterprises: Enterprise[]
  device_count: number
}

export async function getClusters(): Promise<ClusterWithEnterprises[]> {
  const res = await client.get('/clusters/')
  return res.data
}

export async function createCluster(data: { name: string; host?: string }): Promise<ClusterWithEnterprises> {
  const res = await client.post('/clusters/', data)
  return res.data
}

export async function updateCluster(id: number, data: { name?: string; host?: string }): Promise<ClusterWithEnterprises> {
  const res = await client.patch(`/clusters/${id}/`, data)
  return res.data
}

export async function deleteCluster(id: number): Promise<void> {
  await client.delete(`/clusters/${id}/`)
}

export async function createEnterprise(
  clusterId: number,
  data: { bearer_token: string; is_active?: boolean },
): Promise<Enterprise> {
  const res = await client.post(`/clusters/${clusterId}/enterprises/`, data)
  return res.data
}

export async function updateEnterprise(
  id: number,
  data: { name?: string; bearer_token?: string; is_active?: boolean },
): Promise<Enterprise> {
  const res = await client.patch(`/enterprises/${id}/`, data)
  return res.data
}

export async function deleteEnterprise(id: number): Promise<void> {
  await client.delete(`/enterprises/${id}/`)
}

export async function syncEnterprise(id: number): Promise<Enterprise> {
  const res = await client.post(`/enterprises/${id}/sync/`)
  return res.data
}

export async function exportClusters(): Promise<Blob> {
  const res = await client.get('/clusters/export/', { responseType: 'blob' })
  return res.data
}

export async function importClusters(config: unknown[], onConflict: 'overwrite' | 'skip'): Promise<unknown> {
  const res = await client.post('/clusters/import/', { config: JSON.stringify(config), on_conflict: onConflict })
  return res.data
}

export interface SyncInterval {
  sync_interval_minutes: number
}

export async function getSyncInterval(): Promise<SyncInterval> {
  const res = await client.get('/enterprises/sync-interval/')
  return res.data
}

export async function updateSyncInterval(minutes: number): Promise<SyncInterval> {
  const res = await client.patch('/enterprises/sync-interval/', { sync_interval_minutes: minutes })
  return res.data
}
