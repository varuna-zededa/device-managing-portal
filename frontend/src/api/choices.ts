import client from './client'

export interface EnterpriseChoice {
  id: number
  name: string
  cluster_name: string
}

export interface Choices {
  labs: string[]
  teams: string[]
  admin_conditions: string[]
  sync_conditions: string[]
  enterprises: EnterpriseChoice[]
}

export async function getChoices(): Promise<Choices> {
  const res = await client.get('/choices/')
  return res.data
}
