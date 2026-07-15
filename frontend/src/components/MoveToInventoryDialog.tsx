import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moveToInventory, type UntrackedDevice } from '@/api/untracked'
import { getChoices } from '@/api/choices'
import { getDeviceModels, createDeviceModel, type DeviceModel } from '@/api/deviceModels'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/sonner'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  device: UntrackedDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ModelCombobox({
  selectedId,
  selectedName,
  models,
  onSelect,
  onCreate,
  creating,
}: {
  selectedId: number | null
  selectedName: string
  models: DeviceModel[]
  onSelect: (model: DeviceModel) => void
  onCreate: (name: string) => void
  creating: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = models.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  )
  const exactMatch = models.some((m) => m.name.toLowerCase() === search.trim().toLowerCase())
  const showCreate = search.trim() !== '' && !exactMatch

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', !selectedId && 'text-muted-foreground')}
        >
          <span className="truncate flex-1 text-left">
            {selectedId ? selectedName : 'Search or create model...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="flex items-center border-b border-border px-3 py-2 gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {showCreate && (
            <button
              type="button"
              disabled={creating}
              onClick={() => {
                onCreate(search.trim())
                setSearch('')
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground cursor-pointer disabled:opacity-50"
            >
              <Plus className="h-4 w-4 shrink-0 text-primary" />
              <span>Create &ldquo;{search.trim()}&rdquo;</span>
            </button>
          )}
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onSelect(m)
                setSearch('')
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground cursor-pointer',
                selectedId === m.id && 'bg-accent/50',
              )}
            >
              <Check className={cn('h-4 w-4 shrink-0', selectedId === m.id ? 'opacity-100 text-primary' : 'opacity-0')} />
              {m.name}
            </button>
          ))}
          {filtered.length === 0 && !showCreate && (
            <p className="py-6 text-center text-sm text-muted-foreground">No models found</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function MoveToInventoryDialog({ device, open, onOpenChange }: Props) {
  const [lab, setLab] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [selectedModelName, setSelectedModelName] = useState('')
  const qc = useQueryClient()

  useEffect(() => {
    if (!open) {
      setLab('')
      setSelectedModelId(null)
      setSelectedModelName('')
    }
  }, [open])

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })
  const { data: models = [] } = useQuery({ queryKey: ['device-models'], queryFn: getDeviceModels })

  const labOptions = (choices?.labs ?? []).map((l) => ({ value: l, label: l }))

  const createModelMut = useMutation({
    mutationFn: (name: string) => createDeviceModel(name),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['device-models'] })
      setSelectedModelId(created.id)
      setSelectedModelName(created.name)
      toast.success(`Model "${created.name}" created`)
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.name ?? 'Failed to create model')
    },
  })

  const mutation = useMutation({
    mutationFn: () => moveToInventory(device!.id, { lab, model: selectedModelId! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['untracked-devices'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${device?.name} moved to inventory`)
      onOpenChange(false)
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error ?? 'Failed to move device')
    },
  })

  if (!device) return null

  const connectivity = device.device_connectivity
  const ifacesSummary = connectivity?.length
    ? connectivity.map((c) => `${c.interface_name} ${c.ip}`).join(', ')
    : '—'

  const rows: [string, string][] = [
    ['Name', device.name],
    ['Serial Number', device.serial_number],
    ['Model (text)', device.model || '—'],
    ['Enterprise', device.enterprise_name],
    ['Cluster', device.cluster_name],
    ['Run State', device.run_state],
    ['EVE Version', device.eve_version ?? '—'],
    ['Interfaces', ifacesSummary],
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move to Inventory</DialogTitle>
          <DialogDescription>Review the device details before confirming.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm border-collapse">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-b last:border-0">
                <td className="py-1.5 pr-4 text-muted-foreground font-medium w-36">{label}</td>
                <td className="py-1.5 font-mono text-xs break-all">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-sm font-medium block mb-1">Lab *</label>
            <SearchableSelect
              options={labOptions}
              value={lab}
              onValueChange={setLab}
              placeholder="Select lab..."
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Device Model *</label>
            <ModelCombobox
              selectedId={selectedModelId}
              selectedName={selectedModelName}
              models={models}
              onSelect={(m) => { setSelectedModelId(m.id); setSelectedModelName(m.name) }}
              onCreate={(name) => createModelMut.mutate(name)}
              creating={createModelMut.isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!lab || !selectedModelId || mutation.isPending}
          >
            {mutation.isPending ? 'Moving...' : 'Confirm Move to Inventory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
