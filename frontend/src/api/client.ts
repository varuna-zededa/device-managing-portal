import axios from 'axios'

const client = axios.create({ baseURL: '/api/v1' })

client.interceptors.request.use((config) => {
  const email = localStorage.getItem('currentUserEmail') || ''
  if (email) config.headers['X-User-Email'] = email
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('currentUserEmail')
      window.location.reload()
    }
    return Promise.reject(error)
  },
)

export default client
