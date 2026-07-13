import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUntrackedDevices, type UntrackedDevice } from '@/api/untracked'
import { Header } from '@/components/Header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MoveToInventoryDialog } from '@/components/MoveToInventoryDialog'
import { PackagePlus } from 'lucide-react'

function timeStr(dt: string) {
  return new Date(dt).toLocaleString()
}

function Dot() {
  return <span className="text-muted-foreground text-base select-none">·</span>
}

function formatRunState(raw: string) {
  return raw.replace(/^RUN_STATE_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

const STATE_COLORS: Record<string, string> = {
  Online:    'text-status-online',
  Halted:    'text-red-400',
  Suspended: 'text-orange-400',
}

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

export default function UntrackedDevicesPage() {
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [serialFilter, setSerialFilter] = useState('')
  const [selected, setSelected] = useState<UntrackedDevice | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

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

  const devices = useMemo(() => {
    let d = allDevices
    if (enterpriseFilter) d = d.filter(x => x.enterprise_name === enterpriseFilter)
    if (clusterFilter) d = d.filter(x => x.cluster_name === clusterFilter)
    if (serialFilter) {
      const q = serialFilter.toLowerCase()
      d = d.filter(x => x.serial_number.toLowerCase().includes(q))
    }
    return d
  }, [allDevices, enterpriseFilter, clusterFilter, serialFilter])

  function openMove(d: UntrackedDevice) {
    setSelected(d)
    setDialogOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-base font-semibold text-foreground">Untracked Devices</h1>
            {!isLoading && (() => {
              const { total, clusters, stateCounts } = buildSummary(devices)
              return (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="text-foreground">{total} total</span>
                  <Dot /><span>{clusters} cluster{clusters !== 1 ? 's' : ''}</span>
                  {Object.entries(stateCounts).sort().map(([label, count]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <Dot />
                      <span className={STATE_COLORS[label] ?? ''}>{count} {label.toLowerCase()}</span>
                    </span>
                  ))}
                </p>
              )
            })()}
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

          <Input
            placeholder="Serial number..."
            value={serialFilter}
            onChange={(e) => setSerialFilter(e.target.value)}
            className="w-48 h-9"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {(['Name', 'Serial No', 'Model', 'Enterprise', 'Cluster', 'Run State', 'EVE Version', 'First Seen', 'Last Seen', ''] as const).map((h) => (
                  <th key={h} className="h-11 px-4 text-left font-medium text-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={10} className="px-4 py-8 text-sm text-muted-foreground">Loading...</td></tr>
              )}
              {devices.map((d) => (
                <tr key={d.id} className="border-b border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{d.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{d.serial_number}</td>
                  <td className="px-4 py-2 text-xs">{d.model || '—'}</td>
                  <td className="px-4 py-2">{d.enterprise_name}</td>
                  <td className="px-4 py-2">{d.cluster_name}</td>
                  <td className="px-4 py-2 text-xs">{d.run_state}</td>
                  <td className="px-4 py-2 text-xs">{d.eve_version ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{timeStr(d.first_seen_at)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{timeStr(d.last_seen_at)}</td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openMove(d)}>
                      <PackagePlus className="w-3.5 h-3.5 mr-1" /> Move
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && devices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No untracked devices found.</p>
          )}
        </div>

        <MoveToInventoryDialog
          device={selected}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </div>
  )
}
