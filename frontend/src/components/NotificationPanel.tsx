import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPendingReservations, getMyReservations, approveReservation, rejectReservation } from '@/api/reservations'
import { getConfig } from '@/api/config'
import { getNotifications, markNotificationRead, markAllNotificationsRead, type PortalNotification } from '@/api/notifications'
import { updateEnterprise } from '@/api/enterprises'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { currentUser, isAdmin } = useUser()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: Infinity,
  })

  const { data: pending = [] } = useQuery({
    queryKey: ['reservations', 'pending'],
    queryFn: getPendingReservations,
    refetchInterval: config?.notification_refresh_ms ?? 30_000,
  })

  const { data: mine = [] } = useQuery({
    queryKey: ['reservations', 'mine'],
    queryFn: getMyReservations,
    refetchInterval: config?.notification_refresh_ms ?? 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: (token: string) => approveReservation(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (token: string) => rejectReservation(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
  })

  const { data: adminNotifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    enabled: isAdmin,
    refetchInterval: config?.notification_refresh_ms ?? 30_000,
  })

  const markReadMut = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllReadMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const resolveNameMut = useMutation({
    mutationFn: ({ enterpriseId, name }: { enterpriseId: number; name: string }) =>
      updateEnterprise(enterpriseId, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['clusters-enterprises'] })
    },
  })

  function handleNotificationClick(n: PortalNotification) {
    if (n.kind === 'name_mismatch') return  // handled by inline buttons
    markReadMut.mutate(n.id)
    if (n.kind === 'token_expired' || n.kind === 'sync_error' || n.kind === 'enterprise_inactive') {
      navigate('/cluster-enterprises')
    }
    setOpen(false)
  }

  function parseMismatch(body: string): { local_name: string; zcloud_name: string } | null {
    try { return JSON.parse(body) } catch { return null }
  }

  const unreadAdminCount = adminNotifications.filter((n) => !n.is_read).length

  const actionable = pending.filter((r) => r.status === 'pending')
  const count = actionable.length + unreadAdminCount

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative p-2 rounded-md hover:bg-accent transition-colors"
          aria-label="Notifications"
        >
          <Bell className={cn('w-5 h-5 transition-colors', count > 0 ? 'text-primary' : 'text-foreground')} />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-0.5">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 max-h-[480px] overflow-y-auto">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-semibold">Notifications</h3>
        </div>

        {actionable.length > 0 && (
          <div>
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Awaiting your approval</p>
            </div>
            {actionable.map((r) => (
              <div key={r.id} className="px-3 py-2 hover:bg-muted/50 border-b border-border/50">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.device_name ?? `Device #${r.device}`}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {r.requester_name ?? r.requester_email} · {timeAgo(r.requested_at)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => approveMutation.mutate(r.token)}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="w-3 h-3" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => rejectMutation.mutate(r.token)}
                    disabled={rejectMutation.isPending}
                  >
                    <X className="w-3 h-3" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {mine.length > 0 && (
          <div>
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">My requests</p>
            </div>
            {mine.map((r) => (
              <div key={r.id} className="px-3 py-2 hover:bg-muted/50 border-b border-border/50">
                <p className="text-sm font-medium truncate">{r.device_name ?? `Device #${r.device}`}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs text-muted-foreground">{timeAgo(r.requested_at)}</p>
                  <span
                    className={cn(
                      'text-xs font-medium capitalize',
                      r.status === 'approved' && 'text-status-online',
                      r.status === 'rejected' && 'text-destructive',
                      r.status === 'pending' && 'text-muted-foreground',
                    )}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && adminNotifications.length > 0 && (
          <div>
            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">System Alerts</p>
              {unreadAdminCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => markAllReadMut.mutate()}
                >
                  Mark all read
                </button>
              )}
            </div>
            {adminNotifications.slice(0, 10).map((n) => {
              if (n.kind === 'name_mismatch') {
                const mismatch = parseMismatch(n.body)
                return (
                  <div key={n.id} className={cn('px-3 py-2 border-b border-border/50', !n.is_read && 'bg-muted/20')}>
                    <p className={cn('text-sm font-medium', !n.is_read && 'text-foreground')}>{n.title}</p>
                    {mismatch && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Local: <span className="font-mono">{mismatch.local_name}</span>
                        {' · '}ZedCloud: <span className="font-mono">{mismatch.zcloud_name}</span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                    {!n.is_read && mismatch && n.enterprise != null && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={resolveNameMut.isPending}
                          onClick={() => {
                            resolveNameMut.mutate(
                              { enterpriseId: n.enterprise!, name: mismatch.zcloud_name },
                              { onSuccess: () => markReadMut.mutate(n.id) },
                            )
                          }}
                        >
                          Use "{mismatch.zcloud_name}"
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={markReadMut.isPending}
                          onClick={() => markReadMut.mutate(n.id)}
                        >
                          Keep "{mismatch.local_name}"
                        </Button>
                      </div>
                    )}
                  </div>
                )
              }
              return (
                <div
                  key={n.id}
                  className={cn(
                    'px-3 py-2 hover:bg-muted/50 border-b border-border/50 cursor-pointer',
                    !n.is_read && 'bg-muted/20',
                  )}
                  onClick={() => handleNotificationClick(n)}
                >
                  <p className={cn('text-sm font-medium', !n.is_read && 'text-foreground')}>{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(n.created_at)}</p>
                </div>
              )
            })}
          </div>
        )}

        {actionable.length === 0 && mine.length === 0 && (!isAdmin || adminNotifications.length === 0) && (
          <div className="py-8 text-center text-sm text-foreground">
            No notifications
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
