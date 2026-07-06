import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { getUsers, createUser } from '@/api/users'
import { useUser } from '@/context/UserContext'
import { Header } from '@/components/Header'
import { FloatingAddButton } from '@/components/FloatingAddButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from '@/components/ui/sonner'

const TEAMS = ['ST', 'EVE', 'PLATFORM']

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email_prefix: z.string().min(1, 'Email prefix is required').regex(/^[a-zA-Z0-9._-]+$/, 'Invalid email prefix'),
  team: z.string().min(1, 'Team is required'),
  user_type: z.enum(['admin', 'team_member']),
})

type FormValues = z.infer<typeof schema>

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function UsersPage() {
  const { isAdmin } = useUser()
  const [addOpen, setAddOpen] = useState(false)
  const qc = useQueryClient()

  if (!isAdmin) return <Navigate to="/devices" replace />

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email_prefix: '', team: '', user_type: 'team_member' },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) => createUser(values),
    onSuccess: () => {
      toast.success('User created')
      qc.invalidateQueries({ queryKey: ['users'] })
      setAddOpen(false)
      form.reset()
    },
    onError: () => toast.error('Failed to create user'),
  })

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center px-4 py-3 border-b border-border">
          <h1 className="text-base font-semibold">Users</h1>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="h-11 px-4 text-left font-medium text-muted-foreground">Name</th>
                <th className="h-11 px-4 text-left font-medium text-muted-foreground">Email</th>
                <th className="h-11 px-4 text-left font-medium text-muted-foreground">Team</th>
                <th className="h-11 px-4 text-left font-medium text-muted-foreground">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="w-7 h-7">
                        <AvatarFallback className="text-xs">{initials(u.name)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">{u.team}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={u.user_type === 'admin' ? 'default' : 'secondary'}
                      className="text-xs capitalize"
                    >
                      {u.user_type.replace('_', ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <FloatingAddButton onClick={() => setAddOpen(true)} tooltip="Add User" />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email_prefix" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-1">
                      <Input {...field} className="flex-1" placeholder="username" />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">@zededa.com</span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="team" render={({ field }) => (
                <FormItem>
                  <FormLabel>Team</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select team..." /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TEAMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="user_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="team_member">Team Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
