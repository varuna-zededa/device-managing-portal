import client from './client'

export interface PortalUser {
  id: number
  name: string
  email: string
  team: string
  user_type: string
}

export async function getUsers(): Promise<PortalUser[]> {
  const res = await client.get('/users/')
  return res.data
}

export async function createUser(data: {
  name: string
  email_prefix: string
  team: string
  user_type: string
}): Promise<PortalUser> {
  const res = await client.post('/users/', data)
  return res.data
}

export async function updateUser(id: number, data: {
  name?: string
  team?: string
  user_type?: string
}): Promise<PortalUser> {
  const res = await client.patch(`/users/${id}/`, data)
  return res.data
}

export async function exportUsers(): Promise<Blob> {
  const res = await client.get('/users/export/', { responseType: 'blob' })
  return res.data
}

export async function importUsers(data: unknown[], onConflict: 'overwrite' | 'skip'): Promise<{
  created: number; updated: number; skipped: number; errors: string[]
}> {
  const res = await client.post('/users/import/', { users: JSON.stringify(data), on_conflict: onConflict })
  return res.data
}
