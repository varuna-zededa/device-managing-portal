import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { createCluster, type Cluster } from '@/api/clusters'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const schema = z.object({
  name: z.string().min(1, 'Cluster name is required'),
  host: z.string().min(1, 'Host is required'),
})

type FormValues = z.infer<typeof schema>

interface AddClusterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (cluster: Cluster) => void
}

export function AddClusterModal({ open, onOpenChange, onCreated }: AddClusterModalProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', host: '' },
  })

  const nameVal = form.watch('name')

  useEffect(() => {
    if (!nameVal) return
    const host =
      nameVal.toLowerCase() === 'prod'
        ? 'zedcontrol.zededa.net'
        : `zedcontrol.${nameVal.toLowerCase()}.zededa.net`
    form.setValue('host', host, { shouldDirty: false })
  }, [nameVal, form])

  const mutation = useMutation({
    mutationFn: (values: FormValues) => createCluster(values),
    onSuccess: (cluster) => {
      toast.success(`Cluster "${cluster.name}" created`)
      onCreated(cluster)
      onOpenChange(false)
      form.reset()
    },
    onError: () => toast.error('Failed to create cluster'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Cluster</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="e.g. staging" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Host</FormLabel>
                  <FormControl><Input placeholder="zedcontrol.example.zededa.net" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
