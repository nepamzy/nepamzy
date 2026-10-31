import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Input } from '@/components/ui/fields'
import {
  saveCategoryAction,
  saveDeliveryPointAction,
  setDeliveryPointGeoAction,
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

/** Puts a delivery point on the real map: where it is, how close a rider must get, and whether it is a real approved place. */
export function DeliveryPointGeoForm({
  p,
}: {
  p: {
    id: string
    lat: number | null
    lng: number | null
    geofence_radius_m: number | null
    is_synthetic: boolean
  }
}) {
  return (
    <ActionForm
      action={setDeliveryPointGeoAction}
      submitLabel="Save location"
      className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_7rem_auto_auto] sm:space-y-0"
    >
      <input type="hidden" name="id" value={p.id} />
      <Input
        label="Latitude"
        name="lat"
        required
        inputMode="decimal"
        defaultValue={p.lat ?? ''}
        hint="For example 10.5105"
      />
      <Input
        label="Longitude"
        name="lng"
        required
        inputMode="decimal"
        defaultValue={p.lng ?? ''}
        hint="For example 7.4165"
      />
      <Input
        label="Arrival radius (m)"
        name="radius"
        type="number"
        min={10}
        max={500}
        defaultValue={p.geofence_radius_m ?? 60}
      />
      <Checkbox label="Real, approved place" name="real" defaultChecked={!p.is_synthetic} />
    </ActionForm>
  )
}
