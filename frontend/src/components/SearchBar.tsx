import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getChoices } from '@/api/choices'

const CONDITION_LABELS: Record<string, string> = {
  normal: 'Normal',
  out_of_order: 'Out of Order',
  needs_repair: 'Needs Repair',
  temporarily_leased: 'Temporarily Leased',
  dedicated: 'Dedicated',
}

export interface SearchParams {
  q?: string
  available?: 'true' | 'false' | 'all'
  team?: string
  lab?: string
  condition?: string
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
  const conditions = choices?.conditions ?? []

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
          placeholder="Search by name, model, cluster, owner, EVE version, comment..."
          className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
        value={value.team ?? 'all'}
        onValueChange={(v) => onChange({ ...value, team: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-36 text-sm">
          <SelectValue placeholder="Team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Teams</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
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
        value={value.condition ?? 'all'}
        onValueChange={(v) => onChange({ ...value, condition: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className="h-9 w-44 text-sm">
          <SelectValue placeholder="Condition" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Conditions</SelectItem>
          {conditions.map((c) => (
            <SelectItem key={c} value={c}>{CONDITION_LABELS[c] ?? c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
