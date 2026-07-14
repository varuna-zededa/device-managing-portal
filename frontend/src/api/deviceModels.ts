import client from './client'

export interface DeviceModel {
  id: number
  name: string
  customer_partner_name: string | null
}

export async function getDeviceModels(): Promise<DeviceModel[]> {
  const res = await client.get('/models/')
  return res.data
}

export async function createDeviceModel(name: string): Promise<DeviceModel> {
  const res = await client.post('/models/', { name })
  return res.data
}
