import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDevices } from '@/api/devices'
import { getConfig } from '@/api/config'
import { DeviceTable } from '@/components/DeviceTable'
import { Header } from '@/components/Header'
import { SearchBar, type SearchParams } from '@/components/SearchBar'
import { FloatingAddButton } from '@/components/FloatingAddButton'
import { DeviceFormModal } from '@/components/DeviceFormModal'
import { ExportImportPanel } from '@/components/ExportImportPanel'
import { useUser } from '@/context/UserContext'

const FILTER_SESSION_KEY = 'devices_search_params'

function readFilterSession(): SearchParams {
  try {
    const raw = sessionStorage.getItem(FILTER_SESSION_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function Dot() {
  return <span className="text-muted-foreground text-base select-none">·</span>
}

export default function DevicesPage() {
  const { isAdmin } = useUser()
  const [searchParams, setSearchParams] = useState<SearchParams>(readFilterSession)
  const [addOpen, setAddOpen] = useState(false)
  const lastFetchedAt = useRef<number>(Date.now())

  const updateSearch = (params: SearchParams) => {
    setSearchParams(params)
    try { sessionStorage.setItem(FILTER_SESSION_KEY, JSON.stringify(params)) } catch { /* storage unavailable */ }
  }

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: Infinity,
  })

  const { data: devices = [], isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['devices', searchParams],
    queryFn: () => getDevices(searchParams as Parameters<typeof getDevices>[0]),
    refetchInterval: config?.device_list_refresh_ms ?? 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  })

  const staleMinutes = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 60000)
    : 0

  const hasFilters = !!(
    searchParams.q
    || searchParams.available !== 'all'
    || searchParams.team
    || searchParams.lab
    || searchParams.admin_condition
    || searchParams.sync_condition
  )
  const isStale = staleMinutes > 16

  const summary = !isLoading ? {
    total: devices.length,
    available: devices.filter(d => d.is_available).length,
    reserved: devices.filter(d => d.reserved_at !== null).length,
    online: devices.filter(d => d.status === 'Online').length,
    outOfOrder: devices.filter(d => d.admin_condition === 'out_of_order').length,
    leased: devices.filter(d => d.admin_condition === 'temporarily_leased').length,
    dedicated: devices.filter(d => d.admin_condition === 'dedicated').length,
    missing: devices.filter(d => d.sync_condition === 'missing').length,
    needsRecovery: devices.filter(d => d.sync_condition === 'needs_recovery').length,
  } : null

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-14">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-base font-semibold text-foreground">Devices</h1>
            {summary && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="text-foreground">{summary.total} total</span>
                <Dot /><span className="text-status-online">{summary.available} available</span>
                {summary.reserved > 0 && <><Dot /><span>{summary.reserved} reserved</span></>}
                <Dot /><span>{summary.online} online</span>
                {summary.outOfOrder > 0 && <><Dot /><span className="text-red-400">{summary.outOfOrder} out of order</span></>}
                {summary.leased > 0 && <><Dot /><span className="text-violet-400">{summary.leased} leased</span></>}
                {summary.dedicated > 0 && <><Dot /><span className="text-blue-400">{summary.dedicated} dedicated</span></>}
                {summary.missing > 0 && <><Dot /><span className="text-orange-400">{summary.missing} missing</span></>}
                {summary.needsRecovery > 0 && <><Dot /><span className="text-yellow-400">{summary.needsRecovery} needs recovery</span></>}
              </p>
            )}
          </div>
          {isAdmin && <ExportImportPanel />}
        </div>
        <SearchBar value={searchParams} onChange={updateSearch} />
        <DeviceTable
          devices={devices}
          isLoading={isLoading}
          isError={isError}
          isStale={isStale}
          staleMinutes={staleMinutes}
          onRetry={() => refetch()}
          onClearFilters={() => updateSearch({})}
          hasFilters={hasFilters}
          onAdd={() => setAddOpen(true)}
        />
      </div>

      <FloatingAddButton onClick={() => setAddOpen(true)} tooltip="Add Device" />

      <DeviceFormModal open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
