import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDeviceStatus, type Device } from '@/api/devices'
import { getClusters } from '@/api/clusters'
import { getVaultStatus } from '@/api/vault'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'
import { AlertTriangle } from 'lucide-react'

const schema = z.object({
  cluster_id: z.string().optional(),
  cluster_device_name: z.string().optional(),
  bearer_token: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface FetchStatusDialogProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FetchStatusDialog({ device, open, onOpenChange }: FetchStatusDialogProps) {
  const [apiError, setApiError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: getClusters })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cluster_id: device.cluster?.id?.toString() ?? '',
      cluster_device_name: device.cluster_device_name ?? '',
      bearer_token: '',
    },
  })

  const clusterId = form.watch('cluster_id')
  const clusterIdNum = clusterId ? parseInt(clusterId) : null

  const { data: vaultStatus } = useQuery({
    queryKey: ['vault', clusterIdNum],
    queryFn: () => getVaultStatus(clusterIdNum!),
    enabled: !!clusterIdNum,
  })

  const clusterOptions = clusters.map((c) => ({
    value: c.id.toString(),
    label: c.name,
    hint: c.host,
  }))

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      fetchDeviceStatus(device.id, {
        cluster_id: values.cluster_id ? parseInt(values.cluster_id) : undefined,
        cluster_device_name: values.cluster_device_name || undefined,
        bearer_token: values.bearer_token || undefined,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      if (data.status === 'Unknown' && data.eve_version === 'Unknown') {
        const clusterName = clusters.find((c) => c.id.toString() === form.getValues('cluster_id'))?.name ?? 'cluster'
        toast(`${device.name} not found on ${clusterName}`)
      } else {
        toast.success('Status refreshed')
      }
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number; data?: { detail?: string; expected?: string; actual?: string } } })?.response?.status
      const data = (err as { response?: { data?: { detail?: string; expected?: string; actual?: string } } })?.response?.data
      if (status === 409) {
        setApiError(`Serial mismatch — Expected: ${data?.expected ?? '?'} · Got: ${data?.actual ?? '?'}`)
      } else if (status === 403) {
        setApiError('Bearer token invalid or expired')
      } else if (status === 404) {
        toast(`${device.name} not found on cluster`)
        onOpenChange(false)
      } else {
        setApiError(data?.detail ?? `Error ${status}`)
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Refresh Status — {device.name}</DialogTitle>
          <DialogDescription>Fetch the current status from ZedCloud.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => { setApiError(null); mutation.mutate(v); })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="cluster_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cluster</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      options={clusterOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select cluster..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cluster_device_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name in Cluster</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bearer_token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bearer Token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={vaultStatus?.has_token ? '●●●● (vault token available)' : 'Paste token...'}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {apiError && (
              <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {apiError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Fetching...' : 'Fetch Status'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
