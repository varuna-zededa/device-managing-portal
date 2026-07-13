import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDeviceStatus, type Device } from '@/api/devices'
import { getChoices } from '@/api/choices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'
import { AlertTriangle } from 'lucide-react'

const schema = z.object({
  enterprise_id: z.string().optional(),
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

  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })

  const enterpriseOptions = (choices?.enterprises ?? []).map((e) => ({
    value: e.id.toString(),
    label: `${e.name} — ${e.cluster_name}`,
  }))

  const currentEnterpriseId = (device as any).enterprise?.id?.toString() ?? ''

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { enterprise_id: currentEnterpriseId },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      fetchDeviceStatus(device.id, {
        enterprise_id: values.enterprise_id ? parseInt(values.enterprise_id) : undefined,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      if (data.status === 'Unknown' && data.eve_version === 'Unknown') {
        toast(`${device.name} not found in enterprise`)
      } else {
        toast.success('Status refreshed')
      }
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      const s = (err as any)?.response?.status
      const d = (err as any)?.response?.data
      if (s === 409) {
        setApiError(`Serial mismatch — Expected: ${d?.expected ?? '?'} · Got: ${d?.actual ?? '?'}`)
      } else if (s === 403) {
        setApiError('Bearer token invalid or expired')
      } else if (s === 404) {
        toast(`${device.name} not found in selected enterprise`)
        onOpenChange(false)
      } else {
        setApiError(d?.error ?? d?.detail ?? `Error ${s}`)
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Refresh Status — {device.name}</DialogTitle>
          <DialogDescription>Fetch current status from ZedCloud via an enterprise credential.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => { setApiError(null); mutation.mutate(v) })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="enterprise_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Enterprise</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      options={enterpriseOptions}
                      value={field.value ?? ''}
                      onValueChange={field.onChange}
                      placeholder="Select enterprise..."
                      hintBelow
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
