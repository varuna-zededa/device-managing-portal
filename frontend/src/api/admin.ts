import client from './client'

export async function exportDevices(format: 'csv' | 'json'): Promise<Blob> {
  const res = await client.get('/admin/export/', {
    params: { format },
    responseType: 'blob',
  })
  return res.data
}

export async function downloadImportTemplate(): Promise<Blob> {
  const res = await client.get('/admin/import-template/', { responseType: 'blob' })
  return res.data
}

export async function importDevices(
  file: File,
  mode: 'create_only' | 'update_or_create',
): Promise<{ created: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mode', mode)
  const res = await client.post('/admin/import/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}
