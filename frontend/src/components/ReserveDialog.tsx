import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { reserveDevice, type Device } from '@/api/devices'
import { useUser } from '@/context/UserContext'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

interface ReserveDialogProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingRequester?: string
  pendingExpiry?: string
}

function timeUntil(dateStr: string) {
  const ms = new Date(dateStr).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function ReserveDialog({ device, open, onOpenChange, pendingRequester, pendingExpiry }: ReserveDialogProps) {
  const { currentUser } = useUser()
  const qc = useQueryClient()
  const [conflictInfo, setConflictInfo] = useState<{ requester: string; expiry: string } | null>(null)

  const mutation = useMutation({
    mutationFn: () => reserveDevice(device.id),
    onSuccess: (result) => {
      setConflictInfo(null)
      toast.success(result.immediate ? `Reserved ${device.name}` : `Request sent to ${device.owner_name ?? device.owner_email}`)
      qc.invalidateQueries({ queryKey: ['devices'] })
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { status?: number; data?: { error?: string; detail?: string; requester?: string; expires_at?: string } } })?.response
      if (resp?.status === 409 && resp.data?.requester) {
        setConflictInfo({ requester: resp.data.requester, expiry: resp.data.expires_at ?? '' })
        return
      }
      const msg = resp?.data?.error ?? resp?.data?.detail ?? 'Failed to reserve'
      toast.error(msg)
    },
  })

  const effectiveRequester = conflictInfo?.requester ?? pendingRequester
  const effectiveExpiry = conflictInfo?.expiry ?? pendingExpiry
  const hasPending = !!effectiveRequester && !!effectiveExpiry

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reserve {device.name}</DialogTitle>
          <DialogDescription>
            Reserving as: <span className="font-medium text-foreground">{currentUser?.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div aria-live="polite" aria-atomic="true">
            {hasPending && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
                <Clock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  <span className="font-medium">{effectiveRequester}</span> has already requested this device · expires in{' '}
                  {timeUntil(effectiveExpiry!)}
                </p>
              </div>
            )}
          </div>
          {!hasPending && (device.is_available ? (
            <p className="text-foreground">This device is currently available. It will be assigned to you immediately.</p>
          ) : (
            <p className="text-foreground">
              A request will be sent to{' '}
              <span className="font-medium text-foreground">{device.owner_name ?? device.owner_email}</span> for approval.
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!hasPending && (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Reserving...' : device.is_available ? 'Reserve' : 'Send Request'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
