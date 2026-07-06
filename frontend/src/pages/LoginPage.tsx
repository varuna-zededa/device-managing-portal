import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { getUsers } from '@/api/users'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const navigate = useNavigate()
  const [selectedEmail, setSelectedEmail] = useState<string>('')

  useEffect(() => {
    const stored = localStorage.getItem('currentUserEmail')
    if (stored) navigate('/devices', { replace: true })
  }, [navigate])

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const options = users.map((u) => ({
    value: u.email,
    label: u.name,
    hint: u.email,
    searchText: `${u.name} ${u.email} ${u.team}`,
  }))

  const handleLogin = () => {
    if (!selectedEmail) return
    localStorage.setItem('currentUserEmail', selectedEmail)
    navigate('/devices', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
            <Server className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">Device Portal</h1>
            <p className="text-sm text-muted-foreground mt-1">Select your account to continue</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <SearchableSelect
            options={options}
            value={selectedEmail}
            onValueChange={setSelectedEmail}
            placeholder="Select your name..."
            searchPlaceholder="Search by name or email..."
            isSearching={isLoading}
          />
          <Button className="w-full" onClick={handleLogin} disabled={!selectedEmail}>
            Sign in
          </Button>
        </div>
      </div>
    </div>
  )
}
