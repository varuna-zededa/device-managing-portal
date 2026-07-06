import { useState, useMemo } from 'react'
import { ChevronRight, MoreHorizontal, RefreshCw, Clock, ExternalLink } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { releaseDevice, deleteDevice, type Device } from '@/api/devices'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResizableTable, ResizableTableHead, ResizableTableCell,
  TableHeader, TableBody, TableRow,
} from '@/components/ui/resizable-table'
import { CopyableField } from '@/components/ui/copyable-field'
import { ReserveDialog } from '@/components/ReserveDialog'
import { ForceAssignDialog } from '@/components/ForceAssignDialog'
import { FetchStatusDialog } from '@/components/FetchStatusDialog'
import { OwnershipHistoryModal } from '@/components/OwnershipHistoryModal'
import { DeviceFormModal } from '@/components/DeviceFormModal'
import { toast } from '@/components/ui/sonner'

type SortKey = 'name' | 'cluster' | 'owner' | null
type SortDir = 'asc' | 'desc'

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

const CONDITION_STYLES: Record<string, string> = {
  out_of_order: 'border-l-4 border-l-red-500 bg-red-50/10',
  needs_repair: 'border-l-4 border-l-yellow-400 bg-yellow-50/10',
  temporarily_leased: 'border-l-4 border-l-violet-400 bg-violet-50/10',
  dedicated: 'border-l-4 border-l-blue-400 bg-blue-50/10',
}

const CONDITION_BADGE_STYLES: Record<string, string> = {
  out_of_order: 'bg-red-500/20 text-red-400 border-red-500/30',
  needs_repair: 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  temporarily_leased: 'bg-violet-400/20 text-violet-400 border-violet-400/30',
  dedicated: 'bg-blue-400/20 text-blue-400 border-blue-400/30',
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'Unknown') {
    return <span className="text-xs text-muted-foreground">Unknown</span>
  }
  if (status === 'Online') {
    return <Badge className="bg-badge-online-bg text-badge-online-fg border-badge-online-border text-xs">Online</Badge>
  }
  if (status === 'Offline') {
    return <Badge className="bg-badge-error-bg text-badge-error-fg border-badge-error-border text-xs">Offline</Badge>
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>
}

function ExpandPanel({ device }: { device: Device }) {
  return (
    <tr>
      <td colSpan={9} className="p-0 bg-muted/30">
        <div className="grid grid-cols-3 gap-4 p-4 border-b border-border">
          {/* Card 1: Identity + Placement */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Identity</p>
              <CopyableField label="Serial" value={device.serial_number} mono />
              <CopyableField label="Model" value={device.model.name} />
              {device.model.customer_partner_name && (
                <CopyableField label="Customer / Partner" value={device.model.customer_partner_name} />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Placement</p>
              {device.team && <CopyableField label="Team" value={device.team} />}
              <CopyableField label="Lab" value={device.lab} />
              {device.location_detail && <CopyableField label="Location" value={device.location_detail} />}
            </div>
          </div>

          {/* Card 2: ZedCloud Status + Connectivity */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">ZedCloud Status</p>
              <CopyableField label="EVE Version" value={device.eve_version ?? '—'} mono />
              <CopyableField label="Last Refreshed" value={new Date(device.updated_at).toLocaleString()} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Connectivity</p>
              {device.device_connectivity && device.device_connectivity.length > 0 ? (
                device.device_connectivity.map((iface, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-xs text-muted-foreground font-mono">{iface.interface_name}</span>
                    <span className="text-xs font-mono text-foreground">{iface.mac} · {iface.ip}</span>
                  </div>
                ))
              ) : device.status === 'Unknown' ? (
                <p className="text-xs text-muted-foreground">Unknown</p>
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Card 3: IDRAC + Notes */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">IDRAC</p>
              {device.idrac_ip ? (
                <>
                  <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">Console</span>
                    <a
                      href={`http://${device.idrac_ip}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  {device.idrac_username && (
                    <CopyableField label="Credentials" value={device.idrac_username} mono />
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notes</p>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {device.description ?? '—'}
              </p>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

interface DeviceTableProps {
  devices: Device[]
  isLoading: boolean
  isError: boolean
  isStale: boolean
  staleMinutes: number
  onRetry: () => void
  onClearFilters: () => void
  hasFilters: boolean
  onAdd: () => void
}

export function DeviceTable({
  devices,
  isLoading,
  isError,
  isStale,
  staleMinutes,
  onRetry,
  onClearFilters,
  hasFilters,
  onAdd,
}: DeviceTableProps) {
  const { currentUser, isAdmin } = useUser()
  const qc = useQueryClient()
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [reserveDevice, setReserveDevice] = useState<Device | null>(null)
  const [forceAssignDevice, setForceAssignDevice] = useState<Device | null>(null)
  const [fetchStatusDevice, setFetchStatusDevice] = useState<Device | null>(null)
  const [historyDevice, setHistoryDevice] = useState<Device | null>(null)
  const [editDevice, setEditDevice] = useState<Device | null>(null)

  const releaseMutation = useMutation({
    mutationFn: (id: number) => releaseDevice(id),
    onSuccess: () => { toast.success('Device released'); qc.invalidateQueries({ queryKey: ['devices'] }) },
    onError: () => toast.error('Failed to release device'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDevice(id),
    onSuccess: () => { toast.success('Device deleted'); qc.invalidateQueries({ queryKey: ['devices'] }) },
    onError: () => toast.error('Failed to delete device'),
  })

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return devices
    return [...devices].sort((a, b) => {
      let av = '', bv = ''
      if (sortKey === 'name') { av = a.name; bv = b.name }
      if (sortKey === 'cluster') { av = a.cluster?.name ?? ''; bv = b.cluster?.name ?? '' }
      if (sortKey === 'owner') { av = a.owner_name ?? a.owner_email ?? ''; bv = b.owner_name ?? b.owner_email ?? '' }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [devices, sortKey, sortDir])

  if (isLoading) {
    return (
      <div className="w-full">
        {isStale && <StaleBanner minutes={staleMinutes} onRetry={onRetry} />}
        <table className="w-full text-sm">
          <tbody>
            {[...Array(8)].map((_, i) => (
              <tr key={i} className="border-b border-border">
                {[...Array(9)].map((_, j) => (
                  <td key={j} className="p-4">
                    <Skeleton className="h-5 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground">Failed to load devices</p>
        <Button variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    )
  }

  if (devices.length === 0 && !hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground">No devices yet</p>
        <Button onClick={onAdd}>Add Device</Button>
      </div>
    )
  }

  if (devices.length === 0 && hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-muted-foreground">No devices match your filters</p>
        <Button variant="outline" onClick={onClearFilters}>Clear Filters</Button>
      </div>
    )
  }

  return (
    <>
      {isStale && <StaleBanner minutes={staleMinutes} onRetry={onRetry} />}
      <div className={cn('transition-opacity', isStale && 'opacity-60')}>
        <ResizableTable tableId="devices-table" leadingColumns={2}>
          <TableHeader>
            <tr>
              <ResizableTableHead columnId="expand" minWidth={40} defaultWidth={40} isLast={false}>
                <span className="sr-only">Expand</span>
              </ResizableTableHead>
              <ResizableTableHead
                columnId="name"
                defaultWidth={200}
                sortDirection={sortKey === 'name' ? sortDir : null}
                onSort={() => handleSort('name')}
              >
                Name
              </ResizableTableHead>
              <ResizableTableHead columnId="serial" defaultWidth={140}>Serial No</ResizableTableHead>
              <ResizableTableHead
                columnId="cluster"
                defaultWidth={120}
                sortDirection={sortKey === 'cluster' ? sortDir : null}
                onSort={() => handleSort('cluster')}
              >
                Cluster
              </ResizableTableHead>
              <ResizableTableHead columnId="clusterName" defaultWidth={140}>Name in Cluster</ResizableTableHead>
              <ResizableTableHead
                columnId="owner"
                defaultWidth={180}
                sortDirection={sortKey === 'owner' ? sortDir : null}
                onSort={() => handleSort('owner')}
              >
                Owner
              </ResizableTableHead>
              <ResizableTableHead columnId="status" defaultWidth={120}>Status</ResizableTableHead>
              <ResizableTableHead columnId="comment" defaultWidth={200}>Comment</ResizableTableHead>
              <ResizableTableHead columnId="actions" defaultWidth={60} isLast>
                <span className="sr-only">Actions</span>
              </ResizableTableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {sorted.map((device) => {
              const isExpanded = expandedIds.has(device.id)
              const condClass = CONDITION_STYLES[device.condition] ?? ''
              const isOwner = device.owner_email === currentUser?.email
              const isUnavailable = ['out_of_order', 'temporarily_leased'].includes(device.condition)
              const isDedicated = device.condition === 'dedicated'

              return [
                <TableRow
                  key={device.id}
                  className={cn('group', condClass)}
                >
                  <ResizableTableCell columnId="expand" truncate={false} className="w-10 px-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(device.id)}
                      className="p-1 rounded hover:bg-accent transition-colors"
                    >
                      <ChevronRight
                        className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
                      />
                    </button>
                  </ResizableTableCell>

                  <ResizableTableCell columnId="name">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{device.name}</span>
                      {device.condition !== 'normal' && (
                        <span
                          className={cn(
                            'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                            CONDITION_BADGE_STYLES[device.condition],
                          )}
                        >
                          {device.condition.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </ResizableTableCell>

                  <ResizableTableCell columnId="serial">
                    <span className="font-mono text-xs">{device.serial_number}</span>
                  </ResizableTableCell>

                  <ResizableTableCell columnId="cluster">
                    {device.cluster ? (
                      <Badge variant="outline" className="text-xs font-normal">{device.cluster.name}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </ResizableTableCell>

                  <ResizableTableCell columnId="clusterName">
                    {device.cluster_device_name ? (
                      <span className="font-mono text-xs">{device.cluster_device_name}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </ResizableTableCell>

                  <ResizableTableCell columnId="owner" truncate={false}>
                    <OwnerCell
                      device={device}
                      currentUserEmail={currentUser?.email ?? ''}
                      isAdmin={isAdmin}
                      isOwner={isOwner}
                      isUnavailable={isUnavailable}
                      isDedicated={isDedicated}
                      onReserve={() => setReserveDevice(device)}
                      onRelease={() => releaseMutation.mutate(device.id)}
                    />
                  </ResizableTableCell>

                  <ResizableTableCell columnId="status" truncate={false}>
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={device.status} />
                      <button
                        type="button"
                        onClick={() => setFetchStatusDevice(device)}
                        className="text-xs text-primary hover:underline text-left"
                      >
                        <RefreshCw className="inline w-3 h-3 mr-0.5" />Refresh
                      </button>
                    </div>
                  </ResizableTableCell>

                  <ResizableTableCell columnId="comment">
                    {device.last_comment_text ? (
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {device.last_comment_text}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </ResizableTableCell>

                  <ResizableTableCell columnId="actions" truncate={false} className="sticky-action-col">
                    <ActionsMenu
                      device={device}
                      isAdmin={isAdmin}
                      onEdit={() => setEditDevice(device)}
                      onDelete={() => {
                        if (confirm(`Delete ${device.name}?`)) deleteMutation.mutate(device.id)
                      }}
                      onForceAssign={() => setForceAssignDevice(device)}
                      onHistory={() => setHistoryDevice(device)}
                    />
                  </ResizableTableCell>
                </TableRow>,
                isExpanded && <ExpandPanel key={`${device.id}-expand`} device={device} />,
              ]
            })}
          </TableBody>
        </ResizableTable>
      </div>

      {reserveDevice && (
        <ReserveDialog
          device={reserveDevice}
          open={!!reserveDevice}
          onOpenChange={(o) => !o && setReserveDevice(null)}
        />
      )}
      {forceAssignDevice && (
        <ForceAssignDialog
          device={forceAssignDevice}
          open={!!forceAssignDevice}
          onOpenChange={(o) => !o && setForceAssignDevice(null)}
        />
      )}
      {fetchStatusDevice && (
        <FetchStatusDialog
          device={fetchStatusDevice}
          open={!!fetchStatusDevice}
          onOpenChange={(o) => !o && setFetchStatusDevice(null)}
        />
      )}
      {historyDevice && (
        <OwnershipHistoryModal
          device={historyDevice}
          open={!!historyDevice}
          onOpenChange={(o) => !o && setHistoryDevice(null)}
        />
      )}
      {editDevice && (
        <DeviceFormModal
          device={editDevice}
          open={!!editDevice}
          onOpenChange={(o) => !o && setEditDevice(null)}
        />
      )}
    </>
  )
}

function StaleBanner({ minutes, onRetry }: { minutes: number; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-sm">
      <span>Couldn't refresh — data from {minutes} min ago</span>
      <button type="button" onClick={onRetry} className="text-xs underline hover:no-underline">
        Retry now
      </button>
    </div>
  )
}

interface OwnerCellProps {
  device: Device
  currentUserEmail: string
  isAdmin: boolean
  isOwner: boolean
  isUnavailable: boolean
  isDedicated: boolean
  onReserve: () => void
  onRelease: () => void
}

function OwnerCell({ device, isAdmin, isOwner, isUnavailable, isDedicated, onReserve, onRelease }: OwnerCellProps) {
  if (isDedicated) {
    return (
      <Badge variant="info" className="text-xs">
        {device.team ?? 'Dedicated'}
      </Badge>
    )
  }

  if (isUnavailable) {
    return <Badge variant="destructive" className="text-xs">UNAVAILABLE</Badge>
  }

  const ownerDisplay = device.owner_name ?? device.owner_email

  return (
    <div className="flex items-center gap-2 min-w-0">
      {ownerDisplay ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar className="w-5 h-5 shrink-0">
            <AvatarFallback className="text-[9px]">{initials(ownerDisplay)}</AvatarFallback>
          </Avatar>
          <span className="text-xs truncate">{ownerDisplay}</span>
        </div>
      ) : null}

      {device.is_available ? (
        <Button size="sm" className="h-6 text-xs px-2 shrink-0" onClick={onReserve}>
          Reserve
        </Button>
      ) : isOwner ? (
        <Button size="sm" variant="outline" className="h-6 text-xs px-2 shrink-0" onClick={onRelease}>
          Release
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-6 text-xs px-2 shrink-0" onClick={onReserve}>
          Reserve
        </Button>
      )}

      {isAdmin && !device.is_available && !isOwner && (
        <Button size="sm" variant="ghost" className="h-6 text-xs px-2 shrink-0" onClick={onRelease}>
          Release
        </Button>
      )}
    </div>
  )
}

interface ActionsMenuProps {
  device: Device
  isAdmin: boolean
  onEdit: () => void
  onDelete: () => void
  onForceAssign: () => void
  onHistory: () => void
}

function ActionsMenu({ device, isAdmin, onEdit, onDelete, onForceAssign, onHistory }: ActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="w-4 h-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuItem onClick={onForceAssign}>Force Assign</DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>Ownership History</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
