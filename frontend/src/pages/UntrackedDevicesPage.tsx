import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUntrackedDevices, type UntrackedDevice } from '@/api/untracked'
import { Header } from '@/components/Header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MoveToInventoryDialog } from '@/components/MoveToInventoryDialog'
import { PackagePlus } from 'lucide-react'

function timeStr(dt: string) {
  return new Date(dt).toLocaleString()
}

export default function UntrackedDevicesPage() {
  const [enterpriseFilter, setEnterpriseFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [serialFilter, setSerialFilter] = useState('')
  const [selected, setSelected] = useState<UntrackedDevice | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['untracked-devices', enterpriseFilter, clusterFilter, serialFilter],
    queryFn: () => getUntrackedDevices({
      enterprise: enterpriseFilter || undefined,
      cluster: clusterFilter || undefined,
      serial_number: serialFilter || undefined,
    }),
  })

  function openMove(d: UntrackedDevice) {
    setSelected(d)
    setDialogOpen(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14 px-4 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Untracked Devices</h1>
          <span className="text-sm text-muted-foreground">{devices.length} device{devices.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex gap-3 mb-4">
          <Input placeholder="Enterprise..." value={enterpriseFilter} onChange={(e) => setEnterpriseFilter(e.target.value)} className="w-40" />
          <Input placeholder="Cluster..." value={clusterFilter} onChange={(e) => setClusterFilter(e.target.value)} className="w-40" />
          <Input placeholder="Serial number..." value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} className="w-48" />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Serial No</th>
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium">Enterprise</th>
                <th className="pb-2 pr-4 font-medium">Cluster</th>
                <th className="pb-2 pr-4 font-medium">Run State</th>
                <th className="pb-2 pr-4 font-medium">EVE Version</th>
                <th className="pb-2 pr-4 font-medium">First Seen</th>
                <th className="pb-2 pr-4 font-medium">Last Seen</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 pr-4 font-medium">{d.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{d.serial_number}</td>
                  <td className="py-2 pr-4 text-xs">{d.model || '—'}</td>
                  <td className="py-2 pr-4">{d.enterprise_name}</td>
                  <td className="py-2 pr-4">{d.cluster_name}</td>
                  <td className="py-2 pr-4 text-xs">{d.run_state}</td>
                  <td className="py-2 pr-4 text-xs">{d.eve_version ?? '—'}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{timeStr(d.first_seen_at)}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{timeStr(d.last_seen_at)}</td>
                  <td className="py-2">
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
      </main>
    </div>
  )
}
