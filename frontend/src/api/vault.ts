import client from './client'

export async function getVaultStatus(cluster_id: number): Promise<{ has_token: boolean }> {
  const res = await client.get(`/vault/${cluster_id}/`)
  return res.data
}
