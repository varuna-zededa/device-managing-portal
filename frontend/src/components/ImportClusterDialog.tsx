import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importClusters } from '@/api/enterprises'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const SAMPLE_JSON = `[
  {
    "cluster_name": "hummingbird",
    "cluster_host": "zcloud.hummingbird.zededa.net",
    "enterprises": [
      {
        "name": "Foundation",
        "bearer_token": "eyJhbGci..."
      },
      {
        "name": "200x85",
        "bearer_token": "eyJhbGci..."
      }
    ]
  }
]`

interface ImportClusterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportClusterDialog({ open, onOpenChange }: ImportClusterDialogProps) {
  const [onConflict, setOnConflict] = useState<'overwrite' | 'skip'>('skip')
  const [fileError, setFileError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<unknown[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => importClusters(parsed!, onConflict),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ['clusters-enterprises'] })
      const syncedCount = result.created_enterprises + result.updated_enterprises
      const msg = `Imported: ${result.created_clusters} clusters, ${result.created_enterprises} enterprises added, ${result.updated_enterprises} updated, ${result.skipped_enterprises} skipped.`
      const syncMsg = syncedCount > 0 ? ` Device sync started for ${syncedCount} enterprise${syncedCount !== 1 ? 's' : ''}.` : ''
      if (result.errors?.length) {
        toast.warning(msg + syncMsg + ` Errors: ${result.errors.join('; ')}`)
      } else {
        toast.success(msg + syncMsg)
      }
      onOpenChange(false)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? 'Import failed')
    },
  })

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(data)) throw new Error('JSON must be an array')
        setParsed(data)
      } catch (err: any) {
        setFileError(err.message)
        setParsed(null)
      }
    }
    reader.readAsText(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Import Cluster Config</DialogTitle>
          <DialogDescription>Select a JSON file to import clusters and enterprises.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Expected format</p>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto font-mono leading-relaxed">{SAMPLE_JSON}</pre>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">JSON File <span className="text-xs font-normal text-muted-foreground">(max 20 enterprises)</span></label>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => document.getElementById('import-file-input')?.click()}>
                Choose File
              </Button>
              <span className="text-sm text-muted-foreground truncate">{fileName ?? 'No file chosen'}</span>
            </div>
            <input id="import-file-input" type="file" accept=".json" onChange={handleFile} className="hidden" />
            {fileName && !fileError && <p className="text-xs text-muted-foreground mt-1">{fileName} — ready</p>}
            {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">If enterprise already exists</label>
            <div className="flex gap-4">
              {(['skip', 'overwrite'] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="on_conflict"
                    value={opt}
                    checked={onConflict === opt}
                    onChange={() => setOnConflict(opt)}
                  />
                  {opt === 'skip' ? 'Skip (keep existing token)' : 'Overwrite token'}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!parsed || mutation.isPending}>
            {mutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
