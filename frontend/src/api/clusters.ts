import client from './client'

export interface Cluster {
  id: number
  name: string
  host: string
}

export async function getClusters(): Promise<Cluster[]> {
  const res = await client.get('/clusters/')
  return res.data
}

export async function createCluster(data: { name: string; host: string }): Promise<Cluster> {
  const res = await client.post('/clusters/', data)
  return res.data
}
