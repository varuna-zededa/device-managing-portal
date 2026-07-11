import { useQuery } from '@tanstack/react-query'
import { getOwnershipHistory, type Device, type OwnershipHistory } from '@/api/devices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

interface OwnershipHistoryModalProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OwnershipHistoryModal({ device, open, onOpenChange }: OwnershipHistoryModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['ownership-history', device.id],
    queryFn: () => getOwnershipHistory(device.id),
    enabled: open,
  })
  const history: OwnershipHistory[] = data?.results ?? []
  const hasMore = data?.has_more ?? false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ownership History — {device.name}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-foreground text-center py-6">No ownership history</p>
        ) : (
          <div className="space-y-0 relative">
            <div className="absolute left-4 top-2 bottom-2 w-px bg-border" />
            {history.map((entry, i) => (
              <div key={entry.id} className="relative flex gap-3 pl-10 pb-5">
                <div className="absolute left-2.5 top-1 w-3 h-3 rounded-full border-2 border-background bg-border" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {entry.owner_email ? (
                      <Avatar className="w-6 h-6">
                        <AvatarFallback className="text-[10px]">{initials(entry.owner_name ?? entry.owner_email)}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Available</span>
                    )}
                    {entry.owner_email && (
                      <span className="text-sm font-medium">{entry.owner_name ?? entry.owner_email}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Changed by {entry.changed_by} · {new Date(entry.changed_at).toLocaleString()}
                  </p>
                  {entry.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">{entry.reason}</p>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-1 pl-10">
              {hasMore
                ? 'Most recent 50 entries shown'
                : `${history.length} ${history.length === 1 ? 'entry' : 'entries'}`}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
