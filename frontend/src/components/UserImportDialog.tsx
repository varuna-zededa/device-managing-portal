import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { importUsers } from '@/api/users'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const SAMPLE_JSON = `[
  {
    "name": "Jane Doe",
    "email": "jane@zededa.com",
    "team": "ST",
    "user_type": "member"
  },
  {
    "name": "Admin User",
    "email": "admin@zededa.com",
    "team": "",
    "user_type": "admin"
  }
]`

interface UserImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserImportDialog({ open, onOpenChange }: UserImportDialogProps) {
  const [onConflict, setOnConflict] = useState<'overwrite' | 'skip'>('skip')
  const [fileError, setFileError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<unknown[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => importUsers(parsed!, onConflict),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      const msg = `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`
      if (result.errors?.length) {
        toast.warning(msg + ` Errors: ${result.errors.join('; ')}`)
      } else {
        toast.success(msg)
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
          <DialogTitle>Import Users</DialogTitle>
          <DialogDescription>Select a JSON file to import portal users.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Expected format</p>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto font-mono leading-relaxed">{SAMPLE_JSON}</pre>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">JSON File <span className="text-xs font-normal text-muted-foreground">(max 100 users)</span></label>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => document.getElementById('user-import-file-input')?.click()}>
                Choose File
              </Button>
              <span className="text-sm text-muted-foreground truncate">{fileName ?? 'No file chosen'}</span>
            </div>
            <input id="user-import-file-input" type="file" accept=".json" onChange={handleFile} className="hidden" />
            {fileName && !fileError && <p className="text-xs text-muted-foreground mt-1">{fileName} — ready</p>}
            {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">If user already exists</label>
            <div className="flex gap-4">
              {(['skip', 'overwrite'] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="user_on_conflict"
                    value={opt}
                    checked={onConflict === opt}
                    onChange={() => setOnConflict(opt)}
                  />
                  {opt === 'skip' ? 'Skip (keep existing)' : 'Overwrite'}
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
