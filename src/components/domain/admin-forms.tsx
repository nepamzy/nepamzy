import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Input } from '@/components/ui/fields'
import {
  saveCategoryAction,
  saveDeliveryPointAction,
} from '@/server/modules/vendors-and-catalogue/actions'

export function CategoryForm({
  c,
}: {
  c?: { id: string; slug: string; name: string; sort_order: number; is_active: boolean }
}) {
  return (
    <ActionForm
      action={saveCategoryAction}
      submitLabel={c ? 'Save' : 'Add category'}
      className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_6rem_auto_auto] sm:space-y-0"
    >
      {c && <input type="hidden" name="id" value={c.id} />}
      <Input label="Name" name="name" required defaultValue={c?.name} maxLength={60} />
      <Input
        label="Slug"
        name="slug"
        required
        defaultValue={c?.slug}
        pattern="[a-z0-9-]{2,40}"
        hint="lowercase, numbers, dashes"
      />
      <Input label="Order" name="sort" type="number" defaultValue={c?.sort_order ?? 0} />
      <Checkbox label="Active" name="active" defaultChecked={c?.is_active ?? true} />
    </ActionForm>
  )
}
export function DeliveryPointForm({
  p,
}: {
  p?: {
    id: string
    label: string
    instructions: string | null
    sort_order: number
    is_active: boolean
  }
}) {
  return (
    <ActionForm
      action={saveDeliveryPointAction}
      submitLabel={p ? 'Save' : 'Add point'}
      className="grid items-end gap-3 sm:grid-cols-[1.4fr_1.4fr_6rem_auto_auto] sm:space-y-0"
    >
      {p && <input type="hidden" name="id" value={p.id} />}
      <Input
        label="Label"
        name="label"
        required
        defaultValue={p?.label}
        minLength={3}
        maxLength={80}
      />
      <Input
        label="Instructions (optional)"
        name="instructions"
        defaultValue={p?.instructions ?? ''}
        maxLength={200}
      />
      <Input label="Order" name="sort" type="number" defaultValue={p?.sort_order ?? 0} />
      <Checkbox label="Active" name="active" defaultChecked={p?.is_active ?? true} />
    </ActionForm>
  )
}
