import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moveToInventory, type UntrackedDevice } from '@/api/untracked'
import { getChoices } from '@/api/choices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'

interface Props {
  device: UntrackedDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoveToInventoryDialog({ device, open, onOpenChange }: Props) {
  const [lab, setLab] = useState('')
  const [modelId, setModelId] = useState('')
  const qc = useQueryClient()

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })

  // For model picker we use the device_models endpoint via choices; fallback to free-text for now.
  // A future task can wire in the device model list — for now the field accepts a numeric ID.
  const labOptions = (choices?.labs ?? []).map((l) => ({ value: l, label: l }))

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
            <label className="text-sm font-medium block mb-1">Device Model ID *</label>
            <input
              type="number"
              className="border rounded px-3 py-1.5 text-sm w-full"
              placeholder="Enter device model ID from /admin"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
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
  )
}
