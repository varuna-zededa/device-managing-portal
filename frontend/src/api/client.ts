import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

client.interceptors.request.use((config) => {
  const email = localStorage.getItem('currentUserEmail') || ''
  if (email) config.headers['X-User-Email'] = email
  return config
})

export default client
