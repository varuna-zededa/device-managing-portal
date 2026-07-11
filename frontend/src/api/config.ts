import client from './client'

export interface PortalConfig {
  device_list_refresh_ms: number
  notification_refresh_ms: number
}

export async function getConfig(): Promise<PortalConfig> {
  const res = await client.get('/config/')
  return res.data
}
