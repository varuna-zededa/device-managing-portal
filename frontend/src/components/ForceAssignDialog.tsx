import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { forceAssignDevice, type Device } from '@/api/devices'
import { getUsers } from '@/api/users'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'

interface ForceAssignDialogProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingRequesterEmail?: string
}

export function ForceAssignDialog({ device, open, onOpenChange, pendingRequesterEmail }: ForceAssignDialogProps) {
  const [selectedEmail, setSelectedEmail] = useState(pendingRequesterEmail ?? '')
  const qc = useQueryClient()

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers })

  const options = users.map((u) => ({
    value: u.email,
    label: u.name,
    hint: u.email === pendingRequesterEmail ? 'has a pending request' : u.email,
    searchText: `${u.name} ${u.email}`,
  }))

  const mutation = useMutation({
    mutationFn: () => forceAssignDevice(device.id, selectedEmail),
    onSuccess: () => {
      toast.success(`${device.name} assigned`)
      qc.invalidateQueries({ queryKey: ['devices'] })
      onOpenChange(false)
    },
    onError: () => toast.error('Failed to assign device'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Force Assign {device.name}</DialogTitle>
          <DialogDescription>Select a user to assign this device to immediately.</DialogDescription>
        </DialogHeader>

        <SearchableSelect
          options={options}
          value={selectedEmail}
          onValueChange={setSelectedEmail}
          placeholder="Select user..."
          searchPlaceholder="Search by name or email..."
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!selectedEmail || mutation.isPending}>
            {mutation.isPending ? 'Assigning...' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
