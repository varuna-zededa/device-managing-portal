import client from './client'

export interface Choices {
  labs: string[]
  teams: string[]
  conditions: string[]
}

export async function getChoices(): Promise<Choices> {
  const res = await client.get('/choices/')
  return res.data
}
