import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import { getReservationByToken, approveReservation, rejectReservation } from '@/api/reservations'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

function apiErrorMessage(err: unknown): string {
  const resp = (err as { response?: { data?: { error?: string; detail?: string } } })?.response
  return resp?.data?.error ?? resp?.data?.detail ?? (err as Error)?.message ?? 'Something went wrong'
}

export default function ConfirmReservationPage() {
  const { token } = useParams<{ token: string }>()
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['reservation', token],
    queryFn: () => getReservationByToken(token!),
    enabled: !!token,
  })

  const approveMutation = useMutation({
    mutationFn: () => approveReservation(token!),
    onSuccess: () => setResult('approved'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectReservation(token!),
    onSuccess: () => setResult('rejected'),
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-foreground">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Invalid Request</h1>
          <p className="text-foreground">This reservation link is invalid or has expired.</p>
        </div>
      </div>
    )
  }

  if (result === 'approved') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-status-online mx-auto" />
          <h1 className="text-xl font-semibold">Reservation Approved</h1>
          <p className="text-foreground">{data.requester_name} has been assigned {data.device_name}.</p>
          <a href="/devices" className="inline-block text-sm text-blue-500 hover:underline">Go to Device Portal →</a>
        </div>
      </div>
    )
  }

  if (result === 'rejected') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Reservation Rejected</h1>
          <p className="text-foreground">The request has been rejected.</p>
          <a href="/devices" className="inline-block text-sm text-blue-500 hover:underline">Go to Device Portal →</a>
        </div>
      </div>
    )
  }

  if (data.status !== 'pending') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <Clock className="w-12 h-12 text-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Already Resolved</h1>
          <p className="text-foreground">This request has already been resolved or expired.</p>
          <p className="text-sm text-foreground capitalize">Status: {data.status}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-lg p-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Reservation Request</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and respond to this device request</p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Device</span>
            <span className="font-medium">{data.device_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Requested by</span>
            <span className="font-medium">{data.requester_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expires at</span>
            <span className="font-medium">{formatDateTime(data.expires_at)}</span>
          </div>
        </div>

        {(approveMutation.error || rejectMutation.error) && (
          <p className="text-sm text-destructive">
            {apiErrorMessage(approveMutation.error ?? rejectMutation.error)}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => rejectMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  )
}
