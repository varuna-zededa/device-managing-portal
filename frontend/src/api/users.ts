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
