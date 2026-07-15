import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moveToInventory, type UntrackedDevice } from '@/api/untracked'
import { getChoices } from '@/api/choices'
import { getModels, type DeviceModel } from '@/api/models'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { AddModelModal } from '@/components/AddModelModal'
import { toast } from '@/components/ui/sonner'
import { Plus } from 'lucide-react'

interface Props {
  device: UntrackedDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoveToInventoryDialog({ device, open, onOpenChange }: Props) {
  const [lab, setLab] = useState('')
  const [modelId, setModelId] = useState('')
  const [addModelOpen, setAddModelOpen] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    if (!open) {
      setLab('')
      setModelId('')
    }
  }, [open])

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })
  const { data: models = [] } = useQuery({ queryKey: ['models'], queryFn: getModels })

  const labOptions = (choices?.labs ?? []).map((l) => ({ value: l, label: l }))
  const modelOptions = models.map((m) => ({ value: m.id.toString(), label: m.name }))

  const mutation = useMutation({
    mutationFn: () => moveToInventory(device!.id, { lab, model: parseInt(modelId) }),
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
    <>
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
              <div className="flex gap-1">
                <div className="flex-1 min-w-0">
                  <SearchableSelect
                    options={modelOptions}
                    value={modelId}
                    onValueChange={setModelId}
                    placeholder="Select model..."
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  aria-label="Add model"
                  onClick={() => setAddModelOpen(true)}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!lab || !modelId || mutation.isPending}
            >
              {mutation.isPending ? 'Moving...' : 'Confirm Move to Inventory'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddModelModal
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        onCreated={(m: DeviceModel) => {
          qc.invalidateQueries({ queryKey: ['models'] })
          setModelId(m.id.toString())
        }}
      />
    </>
  )
}
