import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createModel, type DeviceModel } from '@/api/models'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'

const PARTNER_OPTIONS = [
  'BOBST', 'SLB', 'OnLogic', 'Emmerson', 'Shell', 'Toyota',
].map((v) => ({ value: v, label: v }))

const schema = z.object({
  name: z.string().min(1, 'Model name is required'),
  customer_partner_name: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface AddModelModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (model: DeviceModel) => void
}

export function AddModelModal({ open, onOpenChange, onCreated }: AddModelModalProps) {
  const qc = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', customer_partner_name: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: FormValues) => createModel(values),
    onSuccess: (model) => {
      qc.setQueryData<DeviceModel[]>(['models'], (old = []) => [...old, model])
      toast.success(`Model "${model.name}" created`)
      onCreated(model)
      onOpenChange(false)
      form.reset()
    },
    onError: () => toast.error('Failed to create model'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Dell R750" {...field} spellCheck={false} autoComplete="off" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customer_partner_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer / Partner</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      options={[
                        ...PARTNER_OPTIONS,
                        ...(field.value && !PARTNER_OPTIONS.find((o) => o.value === field.value)
                          ? [{ value: field.value, label: field.value }]
                          : []),
                      ]}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select or type..."
                      emptyMessage="Type to add custom"
                    />
                  </FormControl>
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
