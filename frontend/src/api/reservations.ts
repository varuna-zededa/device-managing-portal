import client from './client'

export interface ReservationRequest {
  id: number
  device: number
  device_name?: string
  requester_email: string
  requester_name?: string
  requested_at: string
  expires_at: string
  status: string
  token: string
}

export async function getPendingReservations(): Promise<ReservationRequest[]> {
  const res = await client.get('/reservations/pending/')
  return res.data
}

export async function getMyReservations(): Promise<ReservationRequest[]> {
  const res = await client.get('/reservations/mine/')
  return res.data
}

export async function getReservationByToken(token: string): Promise<{
  device_name: string
  requester_name: string
  expires_at: string
  status: string
}> {
  const res = await client.get(`/reservations/${token}/`)
  return res.data
}

export async function approveReservation(token: string): Promise<void> {
  await client.post(`/reservations/${token}/approve/`)
}

export async function rejectReservation(token: string): Promise<void> {
  await client.post(`/reservations/${token}/reject/`)
}
