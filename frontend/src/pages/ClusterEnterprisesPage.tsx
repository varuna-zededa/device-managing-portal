import { useState, useEffect } from 'react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ImportClusterDialog } from '@/components/ImportClusterDialog'
import { FloatingAddButton } from '@/components/FloatingAddButton'
import { toast } from '@/components/ui/sonner'
import { Plus, Download, Upload, RefreshCw, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

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


export default function ClusterEnterprisesPage() {
  const qc = useQueryClient()
  const { isAdmin } = useUser()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [expandedInitialized, setExpandedInitialized] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [addingCluster, setAddingCluster] = useState(false)
  const [newClusterName, setNewClusterName] = useState('')
  const [newClusterHost, setNewClusterHost] = useState('')
  const [addingEnterpriseFor, setAddingEnterpriseFor] = useState<number | null>(null)
  const [newEntToken, setNewEntToken] = useState('')
  const [editingEnterprise, setEditingEnterprise] = useState<Enterprise | null>(null)
  const [editEntName, setEditEntName] = useState('')
  const [editEntToken, setEditEntToken] = useState('')

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ['clusters-enterprises'],
    queryFn: getClusters,
  })

  useEffect(() => {
    if (clusters.length > 0 && !expandedInitialized) {
      setExpanded(new Set(clusters.map((c) => c.id)))
      setExpandedInitialized(true)
    }
  }, [clusters, expandedInitialized])

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
    mutationFn: (clusterId: number) => createEnterprise(clusterId, { bearer_token: newEntToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters-enterprises'] })
      setAddingEnterpriseFor(null)
      setNewEntToken('')
      toast.success('Enterprise added. Device sync started.')
    },
    onError: (e: any) => toast.error(e?.response?.data?.bearer_token ?? e?.response?.data?.error ?? 'Failed'),
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
      <div className="pt-14">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-base font-semibold text-foreground">Clusters &amp; Enterprises</h1>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1" />Export</Button>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="w-4 h-4 mr-1" />Import</Button>
            </div>
          )}
        </div>

        <div className="px-4 py-4 space-y-3">
          {isAdmin && addingCluster && (
            <div className="border rounded p-4 space-y-3 bg-muted/30">
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

          {clusters.map((cluster) => (
            <div key={cluster.id} className="border border-border/30 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 select-none"
                onClick={() => toggleExpand(cluster.id)}
              >
                <div className="flex items-center gap-2">
                  {expanded.has(cluster.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium text-sm">{cluster.name}</span>
                  <span className="text-xs text-muted-foreground">{cluster.host}</span>
                  <Badge variant="outline" className="text-xs">{cluster.enterprises.length} enterprise{cluster.enterprises.length !== 1 ? 's' : ''}</Badge>
                  <Badge variant="secondary" className="text-xs">{cluster.device_count} device{cluster.device_count !== 1 ? 's' : ''}</Badge>
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
                <div className="border-t border-border/30 p-3 space-y-3">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {cluster.enterprises.map((ent) => (
                      <div key={ent.id} className="border border-border/25 rounded-lg p-3 bg-background hover:bg-muted/20 group relative">
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {ent.name}
                              {ent.zcloud_username && (
                                <span className="font-normal text-muted-foreground"> — {ent.zcloud_username}</span>
                              )}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {syncBadge(ent.last_sync_status)}
                              {ent.last_sync_error && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-destructive cursor-help underline decoration-dotted">error</span>
                                  </TooltipTrigger>
                                  <TooltipContent><p className="max-w-xs text-xs">{ent.last_sync_error}</p></TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1"><span className="font-medium">Last synced:</span> {formatDateTime(ent.last_sync_at)}</p>
                          </div>
                          {isAdmin && (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => syncEntMut.mutate(ent.id)} disabled={syncEntMut.isPending}>
                                <RefreshCw className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingEnterprise(ent); setEditEntName(ent.name); setEditEntToken('') }}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete ${ent.name}?`)) deleteEntMut.mutate(ent.id) }}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {isAdmin && (
                    addingEnterpriseFor === cluster.id ? (
                      <div className="flex items-center gap-2 pt-1">
                        <Input className="h-7 text-xs w-80" type="password" value={newEntToken} onChange={(e) => setNewEntToken(e.target.value)} placeholder="Bearer token — name fetched from ZedCloud" />
                        <Button size="sm" className="h-7 text-xs" onClick={() => createEntMut.mutate(cluster.id)} disabled={!newEntToken || createEntMut.isPending}>
                          {createEntMut.isPending ? 'Verifying…' : 'Add'}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingEnterpriseFor(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setAddingEnterpriseFor(cluster.id); setNewEntToken('') }}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Enterprise
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
          <ImportClusterDialog open={showImport} onOpenChange={setShowImport} />
        </div>
      </div>
      <FloatingAddButton onClick={() => setAddingCluster(true)} tooltip="Add Cluster" />

      <Dialog open={!!editingEnterprise} onOpenChange={(open) => { if (!open) setEditingEnterprise(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Enterprise</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Name</label>
              <Input value={editEntName} onChange={(e) => setEditEntName(e.target.value)} placeholder="Enterprise name" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Bearer Token</label>
              <Input type="password" value={editEntToken} onChange={(e) => setEditEntToken(e.target.value)} placeholder="Leave blank to keep existing" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEnterprise(null)}>Cancel</Button>
            <Button onClick={() => updateEntMut.mutate()} disabled={updateEntMut.isPending}>
              {updateEntMut.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
