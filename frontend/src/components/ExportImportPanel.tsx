import { useRef, useState } from 'react'
import { Download, Upload, FileJson, FileText } from 'lucide-react'
import { exportDevices, importDevices } from '@/api/admin'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'

export function ExportImportPanel() {
  const [importOpen, setImportOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'create_only' | 'update_or_create'>('create_only')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const blob = await exportDevices(format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `devices.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    }
  }

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    try {
      const res = await importDevices(file, mode)
      setResult(res)
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    setImportOpen(false)
    setFile(null)
    setResult(null)
    setMode('create_only')
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="w-4 h-4" /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport('csv')} className="gap-2">
            <FileText className="w-4 h-4" /> CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('json')} className="gap-2">
            <FileJson className="w-4 h-4" /> JSON
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
        <Upload className="w-4 h-4" /> Import
      </Button>

      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) handleClose(); else setImportOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Devices</DialogTitle>
            <DialogDescription>Upload a CSV or JSON file to import devices.</DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded border border-border p-3">
                  <p className="text-2xl font-bold text-status-online">{result.created}</p>
                  <p className="text-xs text-muted-foreground">Created</p>
                </div>
                <div className="rounded border border-border p-3">
                  <p className="text-2xl font-bold text-primary">{result.updated}</p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
                <div className="rounded border border-border p-3">
                  <p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="rounded border border-destructive/30 p-3 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e) => (
                    <p key={e.row} className="text-xs text-destructive">Row {e.row}: {e.error}</p>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button onClick={handleClose}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files[0]
                  if (f) setFile(f)
                }}
              >
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Drop CSV or JSON here, or click to browse</p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Import Mode</label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create_only">Create only (skip existing)</SelectItem>
                    <SelectItem value="update_or_create">Update or create</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleImport} disabled={!file || importing}>
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
