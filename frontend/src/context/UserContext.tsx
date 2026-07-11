import React, { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUsers, type PortalUser } from '@/api/users'

interface UserContextValue {
  currentUser: PortalUser | null
  isAdmin: boolean
  isLoading: boolean
  logout: () => void
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<PortalUser | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const email = localStorage.getItem('currentUserEmail')
    if (!email) {
      navigate('/login', { replace: true })
      return
    }
    getUsers()
      .then((users) => {
        const found = users.find((u) => u.email === email)
        if (!found) {
          localStorage.removeItem('currentUserEmail')
          navigate('/login', { replace: true })
        } else {
          setCurrentUser(found)
        }
      })
      .catch(() => {
        navigate('/login', { replace: true })
      })
      .finally(() => setLoading(false))
  }, [navigate])

  const logout = () => {
    localStorage.removeItem('currentUserEmail')
    setCurrentUser(null)
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <UserContext.Provider value={{ currentUser: null, isAdmin: false, isLoading: true, logout }}>
        <div className="flex items-center justify-center h-screen">
          <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
        </div>
      </UserContext.Provider>
    )
  }

  return (
    <UserContext.Provider value={{ currentUser, isAdmin: currentUser?.user_type === 'admin', isLoading: false, logout }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used within UserProvider')
  return ctx
}
