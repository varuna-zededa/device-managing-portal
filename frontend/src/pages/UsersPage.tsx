import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil } from 'lucide-react'
import { getUsers, createUser, updateUser, type PortalUser } from '@/api/users'
import { getChoices } from '@/api/choices'
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

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email_prefix: z.string().min(1, 'Email prefix is required').regex(/^[a-zA-Z0-9._-]+$/, 'Invalid email prefix'),
  team: z.string().min(1, 'Team is required'),
  user_type: z.enum(['admin', 'team_member']),
})

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  team: z.string().min(1, 'Team is required'),
  user_type: z.enum(['admin', 'team_member']),
})

type CreateFormValues = z.infer<typeof createSchema>
type EditFormValues = z.infer<typeof editSchema>

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function UsersPage() {
  const { isAdmin } = useUser()
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PortalUser | null>(null)
  const qc = useQueryClient()

  if (!isAdmin) return <Navigate to="/devices" replace />

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })
  const teams = choices?.teams ?? []

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email_prefix: '', team: '', user_type: 'team_member' },
  })

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', team: '', user_type: 'team_member' },
  })

  const mutation = useMutation({
    mutationFn: (values: CreateFormValues) => createUser(values),
    onSuccess: () => {
      toast.success('User created')
      qc.invalidateQueries({ queryKey: ['users'] })
      setAddOpen(false)
      form.reset()
    },
    onError: () => toast.error('Failed to create user'),
  })

  const editMutation = useMutation({
    mutationFn: (values: EditFormValues) => updateUser(editTarget!.id, values),
    onSuccess: () => {
      toast.success('User updated')
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditTarget(null)
    },
    onError: () => toast.error('Failed to update user'),
  })

  function openEdit(user: PortalUser) {
    editForm.reset({ name: user.name, team: user.team, user_type: user.user_type as 'admin' | 'team_member' })
    setEditTarget(user)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center px-4 py-3 border-b border-border">
          <h1 className="text-base font-semibold text-foreground">Users</h1>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="h-11 px-4 text-left font-medium text-foreground">Name</th>
                <th className="h-11 px-4 text-left font-medium text-foreground">Email</th>
                <th className="h-11 px-4 text-left font-medium text-foreground">Team</th>
                <th className="h-11 px-4 text-left font-medium text-foreground">Role</th>
                <th className="h-11 px-4 w-10" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/30 hover:bg-muted/30 group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="w-7 h-7">
                        <AvatarFallback className="text-xs">{initials(u.name)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{u.email}</td>
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
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(u)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent transition-opacity"
                      title="Edit user"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <FloatingAddButton onClick={() => setAddOpen(true)} tooltip="Add User" />

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <p className="text-xs text-muted-foreground -mt-2">{editTarget.email}</p>
          )}
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((v) => editMutation.mutate(v))} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="team" render={({ field }) => (
                <FormItem>
                  <FormLabel>Team</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select team..." /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="user_type" render={({ field }) => (
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
                <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={editMutation.isPending}>
                  {editMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
                      {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
