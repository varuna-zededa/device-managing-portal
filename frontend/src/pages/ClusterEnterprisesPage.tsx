import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getClusters, createCluster, updateCluster, deleteCluster,
  createEnterprise, updateEnterprise, deleteEnterprise, syncEnterprise, exportClusters,
  type ClusterWithEnterprises, type Enterprise,
} from '@/api/enterprises'
import { Header } from '@/components/Header'
import { useUser } from '@/context/UserContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ImportClusterDialog } from '@/components/ImportClusterDialog'
import { toast } from '@/components/ui/sonner'
import { Plus, Download, Upload, RefreshCw, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

function syncBadge(status: Enterprise['last_sync_status']) {
  if (!status) return null
  const map = {
    ok: 'bg-green-100 text-green-800',
    error: 'bg-yellow-100 text-yellow-800',
    token_expired: 'bg-red-100 text-red-800',
  } as const
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status]}`}>
      {status === 'token_expired' ? 'Token Expired' : status === 'error' ? 'Error' : 'OK'}
    </span>
  )
}

function timeStr(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

export default function ClusterEnterprisesPage() {
  const qc = useQueryClient()
  const { isAdmin } = useUser()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [addingCluster, setAddingCluster] = useState(false)
  const [newClusterName, setNewClusterName] = useState('')
  const [newClusterHost, setNewClusterHost] = useState('')
  const [addingEnterpriseFor, setAddingEnterpriseFor] = useState<number | null>(null)
  const [newEntName, setNewEntName] = useState('')
  const [newEntToken, setNewEntToken] = useState('')
  const [editingEnterprise, setEditingEnterprise] = useState<Enterprise | null>(null)
  const [editEntName, setEditEntName] = useState('')
  const [editEntToken, setEditEntToken] = useState('')

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['clusters-enterprises'],
    queryFn: getClusters,
  })

  const createClusterMut = useMutation({
    mutationFn: () => createCluster({ name: newClusterName, host: newClusterHost || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setAddingCluster(false); setNewClusterName(''); setNewClusterHost('') },
    onError: (e: any) => toast.error(e?.response?.data?.host ?? e?.response?.data?.name ?? 'Failed'),
  })

  const deleteClusterMut = useMutation({
    mutationFn: (id: number) => deleteCluster(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Cannot delete cluster'),
  })

  const createEntMut = useMutation({
    mutationFn: (clusterId: number) => createEnterprise(clusterId, { name: newEntName, bearer_token: newEntToken }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setAddingEnterpriseFor(null); setNewEntName(''); setNewEntToken('') },
    onError: (e: any) => toast.error(e?.response?.data?.name ?? e?.response?.data?.bearer_token ?? 'Failed'),
  })

  const updateEntMut = useMutation({
    mutationFn: () => updateEnterprise(editingEnterprise!.id, { name: editEntName || undefined, bearer_token: editEntToken || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); setEditingEnterprise(null) },
    onError: (e: any) => toast.error(e?.response?.data?.name ?? 'Failed'),
  })

  const deleteEntMut = useMutation({
    mutationFn: (id: number) => deleteEnterprise(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }),
    onError: () => toast.error('Failed to delete enterprise'),
  })

  const syncEntMut = useMutation({
    mutationFn: (id: number) => syncEnterprise(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clusters-enterprises'] }); toast.success('Sync triggered') },
    onError: () => toast.error('Sync failed'),
  })

  async function handleExport() {
    const blob = await exportClusters()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cluster-config.json'; a.click()
    URL.revokeObjectURL(url)
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14 px-4 py-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Clusters &amp; Enterprises</h1>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="w-4 h-4 mr-1" />Import</Button>
              <Button size="sm" onClick={() => setAddingCluster(true)}><Plus className="w-4 h-4 mr-1" />Add Cluster</Button>
            </div>
          )}
        </div>

        {isAdmin && addingCluster && (
          <div className="border rounded p-4 mb-4 space-y-3 bg-muted/30">
            <h3 className="text-sm font-medium">New Cluster</h3>
            <Input placeholder="Name" value={newClusterName} onChange={(e) => setNewClusterName(e.target.value)} />
            <Input placeholder="Host (e.g. zcloud.hummingbird.zededa.net)" value={newClusterHost} onChange={(e) => setNewClusterHost(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createClusterMut.mutate()} disabled={!newClusterName || createClusterMut.isPending}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingCluster(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        <div className="space-y-3">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="border rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 select-none"
                onClick={() => toggleExpand(cluster.id)}
              >
                <div className="flex items-center gap-2">
                  {expanded.has(cluster.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium text-sm">{cluster.name}</span>
                  <span className="text-xs text-muted-foreground">{cluster.host}</span>
                  <Badge variant="outline" className="text-xs">{cluster.enterprises.length} enterprise{cluster.enterprises.length !== 1 ? 's' : ''}</Badge>
                </div>
                {isAdmin && (
                  <Button
                    size="sm" variant="ghost"
                    className="text-destructive hover:text-destructive h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete cluster ${cluster.name}?`)) deleteClusterMut.mutate(cluster.id) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {expanded.has(cluster.id) && (
                <div className="border-t">
                  {cluster.enterprises.map((ent) => (
                    <div key={ent.id} className="px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-4 hover:bg-muted/10">
                      {isAdmin && editingEnterprise?.id === ent.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input className="h-7 text-xs w-36" value={editEntName} onChange={(e) => setEditEntName(e.target.value)} placeholder="Name" />
                          <Input className="h-7 text-xs w-64" type="password" value={editEntToken} onChange={(e) => setEditEntToken(e.target.value)} placeholder="New token (leave blank to keep)" />
                          <Button size="sm" className="h-7 text-xs" onClick={() => updateEntMut.mutate()} disabled={updateEntMut.isPending}>Save</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingEnterprise(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-medium">{ent.name}</span>
                            {syncBadge(ent.last_sync_status)}
                            {ent.last_sync_error && (
                              <Tooltip>
                                <TooltipTrigger asChild><span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">error</span></TooltipTrigger>
                                <TooltipContent><p className="max-w-xs text-xs">{ent.last_sync_error}</p></TooltipContent>
                              </Tooltip>
                            )}
                            <span className="text-xs text-muted-foreground hidden sm:block">Last sync: {timeStr(ent.last_sync_at)}</span>
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => syncEntMut.mutate(ent.id)} disabled={syncEntMut.isPending}><RefreshCw className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingEnterprise(ent); setEditEntName(ent.name); setEditEntToken('') }}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete ${ent.name}?`)) deleteEntMut.mutate(ent.id) }}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  {isAdmin && (
                    addingEnterpriseFor === cluster.id ? (
                      <div className="px-4 py-3 flex items-center gap-2 bg-muted/20">
                        <Input className="h-7 text-xs w-36" value={newEntName} onChange={(e) => setNewEntName(e.target.value)} placeholder="Enterprise name" />
                        <Input className="h-7 text-xs w-64" type="password" value={newEntToken} onChange={(e) => setNewEntToken(e.target.value)} placeholder="Bearer token" />
                        <Button size="sm" className="h-7 text-xs" onClick={() => createEntMut.mutate(cluster.id)} disabled={!newEntName || !newEntToken || createEntMut.isPending}>Add</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingEnterpriseFor(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="px-4 py-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAddingEnterpriseFor(cluster.id); setNewEntName(''); setNewEntToken('') }}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Add Enterprise
                        </Button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <ImportClusterDialog open={showImport} onOpenChange={setShowImport} />
      </main>
    </div>
  )
}
