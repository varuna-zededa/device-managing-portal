import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDevices } from '@/api/devices'
import { DeviceTable } from '@/components/DeviceTable'
import { Header } from '@/components/Header'
import { SearchBar, type SearchParams } from '@/components/SearchBar'
import { FloatingAddButton } from '@/components/FloatingAddButton'
import { DeviceFormModal } from '@/components/DeviceFormModal'
import { ExportImportPanel } from '@/components/ExportImportPanel'
import { useUser } from '@/context/UserContext'

export default function DevicesPage() {
  const { isAdmin } = useUser()
  const [searchParams, setSearchParams] = useState<SearchParams>({})
  const [addOpen, setAddOpen] = useState(false)
  const lastFetchedAt = useRef<number>(Date.now())

  const { data: devices = [], isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['devices', searchParams],
    queryFn: () => getDevices(searchParams as Parameters<typeof getDevices>[0]),
    refetchInterval: 15 * 60 * 1000,
    refetchIntervalInBackground: false,
  })

  const staleMinutes = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 60000)
    : 0

  const hasFilters = !!(searchParams.q || searchParams.available !== 'all' || searchParams.team || searchParams.lab || searchParams.condition)
  const isStale = staleMinutes > 16

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <h1 className="text-base font-semibold text-foreground">Devices</h1>
          {isAdmin && <ExportImportPanel />}
        </div>
        <SearchBar value={searchParams} onChange={setSearchParams} />
        <DeviceTable
          devices={devices}
          isLoading={isLoading}
          isError={isError}
          isStale={isStale}
          staleMinutes={staleMinutes}
          onRetry={() => refetch()}
          onClearFilters={() => setSearchParams({})}
          hasFilters={hasFilters}
          onAdd={() => setAddOpen(true)}
        />
      </div>

      <FloatingAddButton onClick={() => setAddOpen(true)} tooltip="Add Device" />

      <DeviceFormModal open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
