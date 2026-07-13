import { useMemo, useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { getUntrackedDevices, type UntrackedDevice } from '@/api/untracked'
import { Header } from '@/components/Header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MoveToInventoryDialog } from '@/components/MoveToInventoryDialog'
import { CopyableField } from '@/components/ui/copyable-field'
import {
  ResizableTable, ResizableTableHead, ResizableTableCell,
  TableHeader, TableBody, TableRow,
} from '@/components/ui/resizable-table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeStr(dt: string) {
  return new Date(dt).toLocaleString()
}

function Dot() {
  return <span className="text-muted-foreground text-base select-none">·</span>
}

function formatRunState(raw: string) {
  return raw.replace(/^RUN_STATE_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// ── Status badge (matches DeviceTable) ───────────────────────────────────────

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

function StatusBadge({ runState }: { runState: string }) {
  const label = formatRunState(runState)
  if (!label || label === 'Unknown') {
    return <span className="text-xs text-muted-foreground">Unknown</span>
  }
  const cls = STATUS_BADGE[label]
  if (cls) return <Badge className={`${cls} text-xs`}>{label}</Badge>
  return <Badge variant="outline" className="text-xs">{label}</Badge>
}

// ── Expand panel ──────────────────────────────────────────────────────────────

function ExpandPanel({ device }: { device: UntrackedDevice }) {
  return (
    <tr>
      <td colSpan={COLUMN_ORDER.length} className="p-0 bg-muted/30">
        <div className="grid grid-cols-3 gap-4 p-4 border-b border-border">
          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">ZedCloud Info</p>
              <CopyableField label="ZedCloud ID" value={device.zcloud_id || '—'} mono />
              <CopyableField label="EVE Version" value={device.eve_version ?? '—'} mono />
              <CopyableField label="Cluster" value={device.cluster_name} />
              <CopyableField label="Host" value={device.cluster_host} mono />
            </div>
          </div>

          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Connectivity</p>
              {device.device_connectivity && device.device_connectivity.length > 0 ? (
                device.device_connectivity.map((iface, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-xs text-foreground font-mono">{iface.interface_name || `Interface ${i + 1}`}</span>
                    <span className="text-xs font-mono text-foreground">{iface.mac} · {iface.ip}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>

          <div className="bg-card rounded-md border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground mb-2">Timeline</p>
              <CopyableField label="First Seen" value={timeStr(device.first_seen_at)} />
              <CopyableField label="Last Seen" value={timeStr(device.last_seen_at)} />
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'serial' | 'enterprise' | 'cluster' | 'status' | null
type SortDir = 'asc' | 'desc'

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(devices: UntrackedDevice[]) {
  const clusters = new Set(devices.map(d => d.cluster_name)).size
  const stateCounts: Record<string, number> = {}
  for (const d of devices) {
    const label = formatRunState(d.run_state)
    stateCounts[label] = (stateCounts[label] ?? 0) + 1
  }
  return { total: devices.length, clusters, stateCounts }
}

const ALL = '__all__'

const COLUMN_ORDER = ['expand', 'name', 'serial', 'model', 'enterprise', 'cluster', 'status', 'actions']

// ── Main component ────────────────────────────────────────────────────────────

export default function UntrackedDevicesPage() {
  const { isAdmin } = useUser()
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [serialFilter, setSerialFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<UntrackedDevice | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: allDevices = [], isLoading } = useQuery({
    queryKey: ['untracked-devices'],
    queryFn: () => getUntrackedDevices(),
  })

  const clusterOptions = useMemo(
    () => [...new Set(allDevices.map(d => d.cluster_name))].sort(),
    [allDevices],
  )

  const enterpriseOptions = useMemo(() => {
    const base = clusterFilter ? allDevices.filter(d => d.cluster_name === clusterFilter) : allDevices
    return [...new Set(base.map(d => d.enterprise_name))].sort()
  }, [allDevices, clusterFilter])

  const statusOptions = useMemo(() => {
    const unique = [...new Set(allDevices.map(d => d.run_state))]
    return unique
      .map(raw => ({ raw, label: formatRunState(raw) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [allDevices])

  const filtered = useMemo(() => {
    let d = allDevices
    if (enterpriseFilter) d = d.filter(x => x.enterprise_name === enterpriseFilter)
    if (clusterFilter) d = d.filter(x => x.cluster_name === clusterFilter)
    if (statusFilter) d = d.filter(x => x.run_state === statusFilter)
    if (serialFilter) {
      const q = serialFilter.toLowerCase()
      d = d.filter(x => x.serial_number.toLowerCase().includes(q))
    }
    return d
  }, [allDevices, enterpriseFilter, clusterFilter, statusFilter, serialFilter])

  const { onlineDevices, otherDevices } = useMemo(() => {
    const sortFn = (a: UntrackedDevice, b: UntrackedDevice) => {
      if (!sortKey) return 0
      let av = '', bv = ''
      switch (sortKey) {
        case 'name':       av = a.name;                      bv = b.name; break
        case 'serial':     av = a.serial_number;             bv = b.serial_number; break
        case 'enterprise': av = a.enterprise_name;           bv = b.enterprise_name; break
        case 'cluster':    av = a.cluster_name;              bv = b.cluster_name; break
        case 'status':     av = formatRunState(a.run_state); bv = formatRunState(b.run_state); break
      }
      if (!av && bv) return 1
      if (av && !bv) return -1
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    const online = filtered.filter(d => d.run_state === 'RUN_STATE_ONLINE').sort(sortFn)
    const other  = filtered.filter(d => d.run_state !== 'RUN_STATE_ONLINE').sort(sortFn)
    return { onlineDevices: online, otherDevices: other }
  }, [filtered, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const summary = !isLoading ? buildSummary([...onlineDevices, ...otherDevices]) : null

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-base font-semibold text-foreground">Untracked Devices</h1>
            {summary && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="text-foreground">{summary.total} total</span>
                <Dot /><span>{summary.clusters} cluster{summary.clusters !== 1 ? 's' : ''}</span>
                {Object.entries(summary.stateCounts).sort().map(([label, count]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <Dot /><span>{count} {label.toLowerCase()}</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-4 py-3 border-b border-border items-center">
          <Select
            value={clusterFilter || ALL}
            onValueChange={(v) => { setClusterFilter(v === ALL ? '' : v); setEnterpriseFilter('') }}
          >
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue placeholder="All Clusters" />
            </SelectTrigger>
            <SelectContent searchable searchPlaceholder="Search cluster...">
              <SelectItem value={ALL}>All Clusters</SelectItem>
              {clusterOptions.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={enterpriseFilter || ALL}
            onValueChange={(v) => setEnterpriseFilter(v === ALL ? '' : v)}
          >
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue placeholder="All Enterprises" />
            </SelectTrigger>
            <SelectContent searchable searchPlaceholder="Search enterprise...">
              <SelectItem value={ALL}>All Enterprises</SelectItem>
              {enterpriseOptions.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter || ALL}
            onValueChange={(v) => setStatusFilter(v === ALL ? '' : v)}
          >
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Statuses</SelectItem>
              {statusOptions.map(({ raw, label }) => (
                <SelectItem key={raw} value={raw}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Serial number..."
            value={serialFilter}
            onChange={(e) => setSerialFilter(e.target.value)}
            className="w-48 h-9"
          />
        </div>

        {isLoading ? (
          <table className="w-full text-sm">
            <tbody>
              {[...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="p-4"><Skeleton className="h-5 w-full" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <ResizableTable tableId="untracked-devices-table" leadingColumns={1} externalColumnOrder={COLUMN_ORDER}>
              <TableHeader>
                <tr>
                  <ResizableTableHead columnId="expand" minWidth={40} defaultWidth={40}>
                    <span className="sr-only">Expand</span>
                  </ResizableTableHead>
                  <ResizableTableHead columnId="name" defaultWidth={200}
                    sortDirection={sortKey === 'name' ? sortDir : null}
                    onSort={() => handleSort('name')}
                  >Name</ResizableTableHead>
                  <ResizableTableHead columnId="serial" defaultWidth={140}
                    sortDirection={sortKey === 'serial' ? sortDir : null}
                    onSort={() => handleSort('serial')}
                  >Serial No</ResizableTableHead>
                  <ResizableTableHead columnId="model" defaultWidth={140}>Model</ResizableTableHead>
                  <ResizableTableHead columnId="enterprise" defaultWidth={150}
                    sortDirection={sortKey === 'enterprise' ? sortDir : null}
                    onSort={() => handleSort('enterprise')}
                  >Enterprise</ResizableTableHead>
                  <ResizableTableHead columnId="cluster" defaultWidth={130}
                    sortDirection={sortKey === 'cluster' ? sortDir : null}
                    onSort={() => handleSort('cluster')}
                  >Cluster</ResizableTableHead>
                  <ResizableTableHead columnId="status" defaultWidth={120}
                    sortDirection={sortKey === 'status' ? sortDir : null}
                    onSort={() => handleSort('status')}
                  >Status</ResizableTableHead>
                  <ResizableTableHead columnId="actions" defaultWidth={60} isLast>
                    <span className="sr-only">Actions</span>
                  </ResizableTableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {([
                  { group: onlineDevices, label: 'Online', count: onlineDevices.length },
                  { group: otherDevices,  label: 'Other',  count: otherDevices.length  },
                ] as const).map(({ group, label, count }) => (
                  <Fragment key={label}>
                    {onlineDevices.length > 0 && otherDevices.length > 0 && (
                      <tr className={label === 'Other' ? 'border-t-2 border-border/60' : ''}>
                        <td colSpan={8} className="px-4 py-1.5 bg-muted/40">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {label} ({count})
                          </span>
                        </td>
                      </tr>
                    )}
                    {group.map(d => {
                      const isExpanded = expandedIds.has(d.id)
                      return (
                        <Fragment key={d.id}>
                          <TableRow className="group">
                            <ResizableTableCell columnId="expand" truncate={false} className="w-10 px-2">
                              <button
                                type="button"
                                onClick={() => toggleExpand(d.id)}
                                className="p-1 rounded hover:bg-accent transition-colors"
                              >
                                <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                              </button>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="name" copyValue={d.name}>
                              <span className="font-medium">{d.name || '—'}</span>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="serial" copyValue={d.serial_number}>
                              <span className="font-mono text-xs">{d.serial_number}</span>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="model">
                              <span className="text-xs">{d.model || '—'}</span>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="enterprise">
                              <span className="text-xs">{d.enterprise_name}</span>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="cluster">
                              <Badge variant="outline" className="text-xs font-normal">{d.cluster_name}</Badge>
                            </ResizableTableCell>
                            <ResizableTableCell columnId="status" truncate={false}>
                              <StatusBadge runState={d.run_state} />
                            </ResizableTableCell>
                            <ResizableTableCell columnId="actions" truncate={false} className="sticky-action-col">
                              {isAdmin && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="w-4 h-4" />
                                      <span className="sr-only">Actions</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => { setSelected(d); setDialogOpen(true) }}>
                                      Move to Inventory
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </ResizableTableCell>
                          </TableRow>
                          {isExpanded && <ExpandPanel device={d} />}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </ResizableTable>

            {onlineDevices.length === 0 && otherDevices.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No untracked devices found.</p>
            )}
          </>
        )}

        <MoveToInventoryDialog
          device={selected}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </div>
  )
}
