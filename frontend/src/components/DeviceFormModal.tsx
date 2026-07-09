import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { createDevice, updateDevice, type Device } from '@/api/devices'
import { getModels } from '@/api/models'
import { getClusters } from '@/api/clusters'
import { getUsers } from '@/api/users'
import { getChoices } from '@/api/choices'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { AddModelModal } from '@/components/AddModelModal'
import { AddClusterModal } from '@/components/AddClusterModal'
import { toast } from '@/components/ui/sonner'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'

const CONDITION_LABELS: Record<string, string> = {
  normal: 'Normal',
  out_of_order: 'Out of Order',
  needs_repair: 'Needs Repair',
  temporarily_leased: 'Temporarily Leased',
  dedicated: 'Dedicated',
}

const CONDITION_COLORS: Record<string, string> = {
  out_of_order: 'text-red-400',
  needs_repair: 'text-yellow-400',
  temporarily_leased: 'text-violet-400',
  dedicated: 'text-blue-400',
}

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  serial_number: z.string().min(1, 'Serial number is required'),
  model_id: z.string().min(1, 'Model is required'),
  cluster_id: z.string().optional(),
  cluster_device_name: z.string().optional(),
  lab: z.string().min(1, 'Lab is required'),
  team: z.string().optional(),
  description: z.string().optional(),
  location_detail: z.string().optional(),
  condition: z.string().default('normal'),
  idrac_ip: z.string().optional(),
  idrac_username: z.string().optional(),
  idrac_password: z.string().optional(),
  owner_email: z.string().optional(),
}).refine(
  (d) => d.condition !== 'dedicated' || !!d.team,
  { message: 'Team is required for dedicated devices', path: ['team'] },
)

type FormValues = z.infer<typeof schema>

interface DeviceFormModalProps {
  device?: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeviceFormModal({ device, open, onOpenChange }: DeviceFormModalProps) {
  const isEdit = !!device
  const { isAdmin } = useUser()
  const qc = useQueryClient()
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [addClusterOpen, setAddClusterOpen] = useState(false)
  const clusterNameEditedRef = useRef(false)

  const { data: models = [] } = useQuery({ queryKey: ['models'], queryFn: getModels })
  const { data: clusters = [] } = useQuery({ queryKey: ['clusters'], queryFn: getClusters })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: getUsers, enabled: isAdmin })
  const { data: choices } = useQuery({ queryKey: ['choices'], queryFn: getChoices, staleTime: Infinity })

  const labs = choices?.labs ?? []
  const teams = choices?.teams ?? []
  const conditions = choices?.conditions ?? []

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      serial_number: '',
      model_id: '',
      cluster_id: '',
      cluster_device_name: '',
      lab: '',
      team: '',
      description: '',
      location_detail: '',
      condition: 'normal',
      idrac_ip: '',
      idrac_username: '',
      idrac_password: '',
      owner_email: '',
    },
  })

  // Reset form with fresh values each time the dialog opens
  useEffect(() => {
    if (open) {
      clusterNameEditedRef.current = false
      form.reset({
        name: device?.name ?? '',
        serial_number: device?.serial_number ?? '',
        model_id: device?.model?.id?.toString() ?? '',
        cluster_id: device?.cluster?.id?.toString() ?? '',
        cluster_device_name: device?.cluster_device_name ?? '',
        lab: device?.lab ?? '',
        team: device?.team ?? '',
        description: device?.description ?? '',
        location_detail: device?.location_detail ?? '',
        condition: device?.condition ?? 'normal',
        idrac_ip: device?.idrac_ip ?? '',
        idrac_username: device?.idrac_username ?? '',
        idrac_password: '',
        owner_email: device?.owner_email ?? '',
      })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-populate Name in Cluster from Name (unless user has manually edited it)
  const nameValue = form.watch('name')
  useEffect(() => {
    if (!clusterNameEditedRef.current) {
      form.setValue('cluster_device_name', nameValue, { shouldDirty: false })
    }
  }, [nameValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const { model_id, cluster_id, ...rest } = values
      const payload: Record<string, unknown> = {
        ...rest,
        model: parseInt(model_id),
        cluster: cluster_id ? parseInt(cluster_id) : null,
      }
      if (!payload.idrac_password) delete payload.idrac_password
      return isEdit ? updateDevice(device!.id, payload) : createDevice(payload)
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Device updated' : 'Device created')
      qc.invalidateQueries({ queryKey: ['devices'] })
      onOpenChange(false)
    },
    onError: () => toast.error(isEdit ? 'Failed to update device' : 'Failed to create device'),
  })

  const modelOptions = models.map((m) => ({
    value: m.id.toString(),
    label: m.name,
    hint: m.customer_partner_name ?? undefined,
  }))

  const clusterOptions = clusters.map((c) => ({
    value: c.id.toString(),
    label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
    hint: c.host,
  }))

  const userOptions = users.map((u) => ({
    value: u.email,
    label: u.name,
    hint: u.email,
  }))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${device!.name}` : 'Add Device'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="serial_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial Number *</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isEdit} className="font-mono" spellCheck={false} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="model_id" render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Model *</FormLabel>
                    <div className="flex gap-1 min-w-0">
                      <FormControl className="min-w-0 flex-1">
                        <SearchableSelect
                          options={modelOptions}
                          value={field.value}
                          onValueChange={field.onChange}
                          placeholder="Select model..."
                        />
                      </FormControl>
                      <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Add model" onClick={() => setAddModelOpen(true)}>
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="lab" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lab *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select lab..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {labs.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="cluster_id" render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Cluster</FormLabel>
                    <div className="flex gap-1 min-w-0">
                      <FormControl className="min-w-0 flex-1">
                        <SearchableSelect
                          options={clusterOptions}
                          value={field.value}
                          onValueChange={field.onChange}
                          placeholder="Select cluster..."
                          hintBelow
                        />
                      </FormControl>
                      <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Add cluster" onClick={() => setAddClusterOpen(true)}>
                        <Plus className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="cluster_device_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name in Cluster</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="font-mono"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          clusterNameEditedRef.current = true
                          field.onChange(e)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="team" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select team..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="condition" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {conditions.map((c) => (
                          <SelectItem key={c} value={c} className={cn(CONDITION_COLORS[c])}>
                            {CONDITION_LABELS[c] ?? c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="location_detail" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location Detail</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="idrac_ip" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDRAC IP</FormLabel>
                    <FormControl><Input {...field} spellCheck={false} autoComplete="off" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="idrac_username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDRAC Username</FormLabel>
                    <FormControl><Input {...field} spellCheck={false} autoComplete="username" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="idrac_password" render={({ field }) => (
                <FormItem>
                  <FormLabel>IDRAC Password {isEdit && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}</FormLabel>
                  <FormControl><Input type="password" {...field} autoComplete="new-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {isAdmin && (
                <FormField control={form.control} name="owner_email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner Email</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        options={userOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Assign to user..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save' : 'Create')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AddModelModal
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        onCreated={(m) => form.setValue('model_id', m.id.toString())}
      />
      <AddClusterModal
        open={addClusterOpen}
        onOpenChange={setAddClusterOpen}
        onCreated={(c) => form.setValue('cluster_id', c.id.toString())}
      />
    </>
  )
}
