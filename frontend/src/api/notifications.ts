import client from './client'

export interface PortalNotification {
  id: number
  kind: 'token_expired' | 'sync_error' | 'name_mismatch' | 'enterprise_inactive' | 'force_assigned'
  enterprise: number | null
  recipient_email: string | null
  title: string
  body: string
  created_at: string
  is_read: boolean
  read_at: string | null
}

export async function getNotifications(): Promise<PortalNotification[]> {
  const res = await client.get('/notifications/')
  return res.data
}

export async function markNotificationRead(id: number): Promise<PortalNotification> {
  const res = await client.post(`/notifications/${id}/read/`)
  return res.data
}

export async function markAllNotificationsRead(): Promise<void> {
  await client.post('/notifications/read-all/')
}
