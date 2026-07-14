import React, { useState, useMemo, Fragment, useRef } from 'react'
import { ChevronRight, MoreHorizontal, RefreshCw, Clock, ExternalLink, X } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { releaseDevice, deleteDevice, setDevicePurpose, type Device } from '@/api/devices'
import { useUser } from '@/context/UserContext'
import { cn, formatDateTime } from '@/lib/utils'
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

// ── Column ordering ──────────────────────────────────────────────────────────

const REORDERABLE_COLS = [
  'name', 'serial', 'cluster', 'clusterName', 'team', 'lab', 'owner', 'status', 'comment',
] as const
type ColId = typeof REORDERABLE_COLS[number]
const COL_ORDER_KEY = 'col-order-devices'

function loadColOrder(): ColId[] {
  try {
    const stored = localStorage.getItem(COL_ORDER_KEY)
    if (stored) {
      const parsed: string[] = JSON.parse(stored)
      const valid = parsed.filter((id): id is ColId =>
        (REORDERABLE_COLS as readonly string[]).includes(id),
      )
      const missing = REORDERABLE_COLS.filter(id => !valid.includes(id))
      return [...valid, ...missing]
    }
  } catch {}
  return [...REORDERABLE_COLS]
}

// ── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'serial' | 'cluster' | 'clusterName' | 'team' | 'lab' | 'owner' | 'status' | null
type SortDir = 'asc' | 'desc'

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'

  const p = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${p(mins, 'min')} ago`

  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${p(hrs, 'hr')} ago`

  const days = Math.floor(hrs / 24)
  if (days < 7) {
    const remHrs = hrs % 24
    const parts = [p(days, 'day')]
    if (remHrs > 0) parts.push(p(remHrs, 'hr'))
    return `${parts.join(', ')} ago`
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7)
    const remDays = days % 7
    const parts = [p(weeks, 'week')]
    if (remDays > 0) parts.push(p(remDays, 'day'))
    return `${parts.join(', ')} ago`
  }

  if (days < 365) {
    const months = Math.floor(days / 30)
    const remDays = days % 30
    const weeks = Math.floor(remDays / 7)
    const finalDays = remDays % 7
    const parts = [p(months, 'month')]
    if (weeks > 0) parts.push(p(weeks, 'week'))
    if (finalDays > 0) parts.push(p(finalDays, 'day'))
    return `${parts.join(', ')} ago`
  }

  const years = Math.floor(days / 365)
  const remAfterYears = days % 365
  const months = Math.floor(remAfterYears / 30)
  const remAfterMonths = remAfterYears % 30
  const weeks = Math.floor(remAfterMonths / 7)
  const parts = [p(years, 'year')]
  if (months > 0) parts.push(p(months, 'month'))
  if (weeks > 0) parts.push(p(weeks, 'week'))
  return `${parts.join(', ')} ago`
}

// ── Style maps ───────────────────────────────────────────────────────────────

const CONDITION_STYLES: Record<string, string> = {
  out_of_order: 'border-l-4 border-l-red-500 bg-red-50/10',
  needs_repair: 'border-l-4 border-l-yellow-400 bg-yellow-50/10',
  temporarily_leased: 'border-l-4 border-l-violet-400 bg-violet-50/10',
  dedicated: 'border-l-4 border-l-blue-400 bg-blue-50/10',
  missing: 'border-l-4 border-l-orange-400 bg-orange-50/10',
}

const CONDITION_BADGE_STYLES: Record<string, string> = {
  out_of_order: 'bg-red-500/20 text-red-400 border-red-500/30',
  needs_repair: 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  temporarily_leased: 'bg-violet-400/20 text-violet-400 border-violet-400/30',
  dedicated: 'bg-blue-400/20 text-blue-400 border-blue-400/30',
  missing: 'bg-orange-400/20 text-orange-400 border-orange-400/30',
}

const STATUS_BADGE: Record<string, string> = {
  Online:               'bg-badge-online-bg text-badge-online-fg border-badge-online-border',
  Suspect:              'bg-badge-warning-bg text-badge-warning-fg border-badge-warning-border',
  Maintenance:          'bg-badge-warning-bg text-badge-warning-fg border-badge-warning-border',
  'Preparing Poweroff': 'bg-badge-warning-bg text-badge-warning-fg border-badge-warning-border',
  'Powering Off':       'bg-badge-warning-bg text-badge-warning-fg border-badge-warning-border',
  'Prepared Poweroff':  'bg-badge-warning-bg text-badge-warning-fg border-badge-warning-border',
  Rebooting:            'bg-badge-info-bg text-badge-info-fg border-badge-info-border',
  Downloading:          'bg-badge-info-bg text-badge-info-fg border-badge-info-border',
  Restarting:           'bg-badge-info-bg text-badge-info-fg border-badge-info-border',
  Booting:              'bg-badge-info-bg text-badge-info-fg border-badge-info-border',
  'BaseOS Updating':    'bg-badge-info-bg text-badge-info-fg border-badge-info-border',
  Provisioned:          'bg-badge-provisioned-bg text-badge-provisioned-fg border-badge-provisioned-border',
  Offline:              'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-border',
  Halted:               'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-border',
  Unprovisioned:        'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-border',
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'Unknown') {
    return <span className="text-xs text-muted-foreground">Unknown</span>
  }
  const cls = STATUS_BADGE[status]
  if (cls) return <Badge className={`${cls} text-xs`}>{status}</Badge>
  return <Badge variant="outline" className="text-xs">{status}</Badge>
}

function ExpandPanel({ device }: { device: Device }) {
  return (
    <tr>
      <td colSpan={11} className="p-0 bg-muted/30">
        <div className="grid grid-cols-3 gap-4 p-4 border-b border-border">
          {/* Card 1: Identity + Placement */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Identity</p>
              <CopyableField label="Model" value={device.model.name} />
              <CopyableField label="Customer / Partner" value={device.model.customer_partner_name ?? '—'} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Placement</p>
              <CopyableField label="Lab" value={device.lab} />
              <CopyableField label="Location" value={device.location_detail ?? '—'} />
            </div>
          </div>

          {/* Card 2: ZedCloud Status + Connectivity */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">ZedCloud Status</p>
              <CopyableField label="EVE Version" value={device.eve_version ?? '—'} mono />
              <CopyableField label="Last Refreshed" value={formatDateTime(device.status_fetched_at)} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Connectivity</p>
              {device.device_connectivity && device.device_connectivity.length > 0 ? (
                device.device_connectivity.map((iface, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-xs text-foreground font-mono">{iface.interface_name || `Interface ${i + 1}`}</span>
                    <span className="text-xs font-mono text-foreground">{iface.mac} · {iface.ip}</span>
                  </div>
                ))
              ) : device.status === 'Unknown' ? (
                <p className="text-xs text-foreground">Unknown</p>
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Card 3: IDRAC + Description */}
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">IDRAC</p>
              <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                <span className="text-sm text-foreground">Console</span>
                {device.idrac_ip ? (
                  <a
                    href={`http://${device.idrac_ip}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <CopyableField label="Credentials" value={device.idrac_username ?? '—'} mono />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Description</p>
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

// ── Main component ────────────────────────────────────────────────────────────

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

  // Column ordering
  const [colOrder, setColOrder] = useState<ColId[]>(loadColOrder)
  const [dragCol, setDragCol] = useState<ColId | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ColId | null>(null)

  const [editingPurposeId, setEditingPurposeId] = useState<number | null>(null)
  const [editingPurposeText, setEditingPurposeText] = useState('')
  const purposeInputRef = useRef<HTMLTextAreaElement>(null)

  const purposeMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) => setDevicePurpose(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
    onError: () => toast.error('Failed to save purpose'),
  })

  const startEditPurpose = (device: Device) => {
    setEditingPurposeId(device.id)
    setEditingPurposeText(device.last_purpose_text ?? '')
    setTimeout(() => purposeInputRef.current?.focus(), 0)
  }

  const savePurpose = (device: Device, overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : editingPurposeText).trim()
    setEditingPurposeId(null)
    if (text !== (device.last_purpose_text ?? '')) {
      purposeMutation.mutate({ id: device.id, text })
    }
  }

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
      switch (sortKey) {
        case 'name':        av = a.name;                              bv = b.name; break
        case 'serial':      av = a.serial_number;                     bv = b.serial_number; break
        case 'cluster':     av = a.cluster?.name ?? '';               bv = b.cluster?.name ?? ''; break
        case 'clusterName': av = a.cluster_device_name ?? '';         bv = b.cluster_device_name ?? ''; break
        case 'team':        av = a.team ?? '';                        bv = b.team ?? ''; break
        case 'lab':         av = a.lab;                               bv = b.lab; break
        case 'owner':       av = a.owner_name ?? a.owner_email ?? ''; bv = b.owner_name ?? b.owner_email ?? ''; break
        case 'status':      av = a.status ?? '';                      bv = b.status ?? ''; break
      }
      if (!av && bv) return 1   // empty values always sort last
      if (av && !bv) return -1
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [devices, sortKey, sortDir])

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────

  const reorderCol = (targetId: ColId) => {
    if (!dragCol || dragCol === targetId) return
    const next = [...colOrder]
    const from = next.indexOf(dragCol)
    const to = next.indexOf(targetId)
    next.splice(from, 1)
    next.splice(to, 0, dragCol)
    setColOrder(next)
    setDragCol(null)
    setDragOverCol(null)
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(next))
  }

  const mkDragProps = (id: ColId) => ({
    draggable: true as const,
    className: cn(
      dragCol === id && 'opacity-40',
      dragOverCol === id && 'bg-primary/5 border-l-2 border-l-primary',
    ),
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; setDragCol(id) },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (dragOverCol !== id) setDragOverCol(id) },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); reorderCol(id) },
    onDragEnd: () => { setDragCol(null); setDragOverCol(null) },
    onDragLeave: () => setDragOverCol(null),
  })

  // ── Column header renderers ──────────────────────────────────────────────────

  const colHeads: Record<ColId, React.ReactNode> = {
    name: (
      <ResizableTableHead columnId="name" defaultWidth={200}
        sortDirection={sortKey === 'name' ? sortDir : null}
        onSort={() => handleSort('name')}
        {...mkDragProps('name')}
      >Name</ResizableTableHead>
    ),
    serial: (
      <ResizableTableHead columnId="serial" defaultWidth={140}
        sortDirection={sortKey === 'serial' ? sortDir : null}
        onSort={() => handleSort('serial')}
        {...mkDragProps('serial')}
      >Serial No</ResizableTableHead>
    ),
    cluster: (
      <ResizableTableHead columnId="cluster" defaultWidth={120}
        sortDirection={sortKey === 'cluster' ? sortDir : null}
        onSort={() => handleSort('cluster')}
        {...mkDragProps('cluster')}
      >Cluster</ResizableTableHead>
    ),
    clusterName: (
      <ResizableTableHead columnId="clusterName" defaultWidth={140}
        sortDirection={sortKey === 'clusterName' ? sortDir : null}
        onSort={() => handleSort('clusterName')}
        {...mkDragProps('clusterName')}
      >Name in Cluster</ResizableTableHead>
    ),
    team: (
      <ResizableTableHead columnId="team" defaultWidth={120}
        sortDirection={sortKey === 'team' ? sortDir : null}
        onSort={() => handleSort('team')}
        {...mkDragProps('team')}
      >Team</ResizableTableHead>
    ),
    lab: (
      <ResizableTableHead columnId="lab" defaultWidth={150}
        sortDirection={sortKey === 'lab' ? sortDir : null}
        onSort={() => handleSort('lab')}
        {...mkDragProps('lab')}
      >Lab</ResizableTableHead>
    ),
    owner: (
      <ResizableTableHead columnId="owner" defaultWidth={180}
        sortDirection={sortKey === 'owner' ? sortDir : null}
        onSort={() => handleSort('owner')}
        {...mkDragProps('owner')}
      >Owner</ResizableTableHead>
    ),
    status: (
      <ResizableTableHead columnId="status" defaultWidth={120}
        sortDirection={sortKey === 'status' ? sortDir : null}
        onSort={() => handleSort('status')}
        {...mkDragProps('status')}
      >Status</ResizableTableHead>
    ),
    comment: (
      <ResizableTableHead columnId="comment" defaultWidth={200} {...mkDragProps('comment')}>Purpose</ResizableTableHead>
    ),
  }

  // ── Column cell renderers ────────────────────────────────────────────────────

  const mkColCells = (
    device: Device,
    isOwner: boolean,
    isUnavailable: boolean,
    isDedicated: boolean,
  ): Record<ColId, React.ReactNode> => ({
    name: (
      <ResizableTableCell columnId="name" copyValue={device.name}>
        <div className="flex flex-col items-start gap-0.5">
          <span className="font-medium truncate">{device.name}</span>
          {device.condition !== 'normal' && (
            <span className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
              CONDITION_BADGE_STYLES[device.condition],
            )}>
              {device.condition.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          )}
        </div>
      </ResizableTableCell>
    ),
    serial: (
      <ResizableTableCell columnId="serial" copyValue={device.serial_number}>
        <span className="font-mono text-xs">{device.serial_number}</span>
      </ResizableTableCell>
    ),
    cluster: (
      <ResizableTableCell columnId="cluster">
        {device.cluster ? (
          <Badge variant="outline" className="text-xs font-normal">{device.cluster.name}</Badge>
        ) : (
          <span className="text-foreground text-xs">—</span>
        )}
      </ResizableTableCell>
    ),
    clusterName: (
      <ResizableTableCell columnId="clusterName" copyValue={device.cluster_device_name ?? undefined}>
        {device.cluster_device_name ? (
          <span className="font-mono text-xs">{device.cluster_device_name}</span>
        ) : (
          <span className="text-foreground text-xs">—</span>
        )}
      </ResizableTableCell>
    ),
    team: (
      <ResizableTableCell columnId="team">
        {device.team ? (
          <span className="text-xs">{device.team}</span>
        ) : (
          <span className="text-foreground text-xs">—</span>
        )}
      </ResizableTableCell>
    ),
    lab: (
      <ResizableTableCell columnId="lab">
        <span className="text-xs">{device.lab}</span>
      </ResizableTableCell>
    ),
    owner: (
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
    ),
    status: (
      <ResizableTableCell columnId="status" truncate={false}>
        <div className="flex flex-col gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-fit"><StatusBadge status={device.status} /></span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Last refresh: {timeAgo(device.status_fetched_at)}
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={() => setFetchStatusDevice(device)}
            className="text-xs text-primary hover:underline text-left"
          >
            <RefreshCw className="inline w-3 h-3 mr-0.5" />Refresh
          </button>
        </div>
      </ResizableTableCell>
    ),
    comment: (
      <ResizableTableCell columnId="comment" truncate={false}>
        {editingPurposeId === device.id ? (
          <div className="flex items-start gap-1">
            <textarea
              ref={purposeInputRef}
              value={editingPurposeText}
              onChange={e => setEditingPurposeText(e.target.value)}
              onBlur={() => savePurpose(device)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); savePurpose(device) }
                if (e.key === 'Escape') { setEditingPurposeId(null) }
              }}
              rows={2}
              className="flex-1 resize-none rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              title="Clear purpose"
              onMouseDown={e => e.preventDefault()}
              onClick={() => savePurpose(device, '')}
              className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            title="Click to edit purpose"
            onClick={() => startEditPurpose(device)}
            onKeyDown={e => e.key === 'Enter' && startEditPurpose(device)}
            className="min-h-[2rem] cursor-text rounded px-1 py-0.5 hover:bg-muted/50"
          >
            {device.last_purpose_text ? (
              <span className="line-clamp-2 text-xs text-foreground">{device.last_purpose_text}</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">Add purpose…</span>
            )}
          </div>
        )}
      </ResizableTableCell>
    ),
  })

  // ── Early returns ────────────────────────────────────────────────────────────

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
        <p className="text-foreground">Failed to load devices</p>
        <Button variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    )
  }

  if (devices.length === 0 && !hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-foreground">No devices yet</p>
        <Button onClick={onAdd}>Add Device</Button>
      </div>
    )
  }

  if (devices.length === 0 && hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-foreground">No devices match your filters</p>
        <Button variant="outline" onClick={onClearFilters}>Clear Filters</Button>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const externalColumnOrder = ['expand', ...colOrder, 'actions']

  return (
    <>
      {isStale && <StaleBanner minutes={staleMinutes} onRetry={onRetry} />}
      <div className={cn('transition-opacity', isStale && 'opacity-60')}>
        <ResizableTable tableId="devices-table" leadingColumns={1} externalColumnOrder={externalColumnOrder}>
          <TableHeader>
            <tr>
              <ResizableTableHead columnId="expand" minWidth={40} defaultWidth={40}>
                <span className="sr-only">Expand</span>
              </ResizableTableHead>
              {colOrder.map(id => (
                <Fragment key={id}>{colHeads[id]}</Fragment>
              ))}
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
              const isUnavailable = ['out_of_order', 'temporarily_leased', 'missing'].includes(device.condition)
              const isDedicated = device.condition === 'dedicated'
              const cells = mkColCells(device, isOwner, isUnavailable, isDedicated)

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

                  {colOrder.map(id => (
                    <Fragment key={id}>{cells[id]}</Fragment>
                  ))}

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
          pendingRequesterEmail={forceAssignDevice.pending_requester_email ?? undefined}
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

// ── Sub-components (below main export) ───────────────────────────────────────

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
      <div className="flex justify-center w-full">
        <Badge variant="info" className="text-xs">
          {device.team ?? 'Dedicated'}
        </Badge>
      </div>
    )
  }

  if (isUnavailable) {
    return (
      <div className="flex justify-center w-full">
        <Badge variant="destructive" className="text-xs">UNAVAILABLE</Badge>
      </div>
    )
  }

  const ownerDisplay = device.owner_name ?? device.owner_email

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      {device.is_available ? (
        <span className="text-xs text-green-500 font-medium">Available</span>
      ) : ownerDisplay ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 min-w-0 cursor-default">
              <Avatar className="w-5 h-5 shrink-0">
                <AvatarFallback className="text-[9px]">{initials(ownerDisplay)}</AvatarFallback>
              </Avatar>
              <span className="text-xs truncate">{ownerDisplay}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            {device.reserved_at ? `Reserved ${timeAgo(device.reserved_at)}` : 'Reservation date unknown'}
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div className="flex items-center gap-1">
        {isOwner ? (
          <Button variant="outline" className="h-6 text-xs px-2 py-0 rounded-md border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRelease}>
            Release
          </Button>
        ) : device.pending_requester_email ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" className="h-6 text-xs px-2 py-0 rounded-md border-amber-500/50 text-amber-500" disabled>
                Request Pending
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              From: {device.pending_requester_name ?? device.pending_requester_email}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="outline" className="h-6 text-xs px-2 py-0 rounded-md border-blue-500/50 text-blue-500 hover:bg-blue-500/10 hover:text-blue-500" onClick={onReserve}>
            Reserve
          </Button>
        )}
      </div>
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
