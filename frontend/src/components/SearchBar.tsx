import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getChoices } from '@/api/choices'

const ADMIN_CONDITION_LABELS: Record<string, string> = {
  normal: 'Normal',
  out_of_order: 'Out of Order',
  temporarily_leased: 'Temporarily Leased',
  dedicated: 'Dedicated',
}

const SYNC_CONDITION_LABELS: Record<string, string> = {
  missing: 'Missing',
  needs_recovery: 'Needs Recovery',
  none: 'No Sync Finding',
}

export interface SearchParams {
  q?: string
  available?: 'true' | 'false' | 'all'
  team?: string
  lab?: string
  admin_condition?: string
  sync_condition?: string
}

interface SearchBarProps {
  value: SearchParams
  onChange: (params: SearchParams) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [inputVal, setInputVal] = useState(value.q ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: choices } = useQuery({
    queryKey: ['choices'],
    queryFn: getChoices,
    staleTime: Infinity,
  })

  const labs = choices?.labs ?? []
  const teams = choices?.teams ?? []
  const adminConditions = choices?.admin_conditions ?? []
  const syncConditions = choices?.sync_conditions ?? []

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange({ ...value, q: inputVal || undefined })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inputVal])

  const availChips: Array<{ key: SearchParams['available']; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'true', label: 'Available' },
    { key: 'false', label: 'Reserved' },
  ]

  const activeAvail = value.available ?? 'all'

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border bg-background">
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Search by name, model, cluster, owner, EVE version, purpose..."
          className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {availChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange({ ...value, available: chip.key })}
            className={cn(
              'px-3 h-9 text-sm transition-colors',
              activeAvail === chip.key
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <Select
        value={value.admin_condition ?? 'all'}
        onValueChange={(v) => onChange({ ...value, admin_condition: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-44 text-sm">
          <SelectValue placeholder="Condition" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Conditions</SelectItem>
          {adminConditions.map((c) => (
            <SelectItem key={c} value={c}>{ADMIN_CONDITION_LABELS[c] ?? c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.sync_condition ?? 'all'}
        onValueChange={(v) => onChange({ ...value, sync_condition: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-40 text-sm">
          <SelectValue placeholder="Sync Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sync Statuses</SelectItem>
          <SelectItem value="none">{SYNC_CONDITION_LABELS['none']}</SelectItem>
          {syncConditions.map((c) => (
            <SelectItem key={c} value={c}>{SYNC_CONDITION_LABELS[c] ?? c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.lab ?? 'all'}
        onValueChange={(v) => onChange({ ...value, lab: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-40 text-sm">
          <SelectValue placeholder="Lab" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Labs</SelectItem>
          {labs.map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.team ?? 'all'}
        onValueChange={(v) => onChange({ ...value, team: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-36 text-sm">
          <SelectValue placeholder="Team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Teams</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
