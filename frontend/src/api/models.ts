import client from './client'

export interface DeviceModel {
  id: number
  name: string
  customer_partner_name: string | null
}

export async function getModels(): Promise<DeviceModel[]> {
  const res = await client.get('/models/')
  return res.data
}

export async function createModel(data: { name: string; customer_partner_name?: string }): Promise<DeviceModel> {
  const res = await client.post('/models/', data)
  return res.data
}
