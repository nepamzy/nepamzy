'use client'
import { useActionState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/fields'
import { Icon } from '@/components/ui/icons'
import {
  deletePlaceAction,
  savePlaceAction,
  toggleWishlistAction,
  updateProfileAction,
} from '@/server/modules/customer/actions'
import type { SavedPlace } from '@/server/modules/customer/queries'
import type { ActionState } from '@/server/modules/shared/action-helpers'

/** Heart button. The saved state shown is always the last answer from the server. */
export function WishlistButton({ productId, saved }: { productId: string; saved: boolean }) {
  const [state, action, pending] = useActionState(toggleWishlistAction, {} as ActionState)
  const on = state.ok ? state.message?.startsWith('Saved') === true : saved
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="productId" value={productId} />
      <Button type="submit" variant="secondary" disabled={pending} aria-pressed={on}>
        <Icon name="heart" size={18} className={on ? 'fill-current text-danger-700' : ''} />
        {on ? 'Saved to wishlist' : 'Save to wishlist'}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm font-medium text-danger-700">
          {state.error}
        </span>
      )}
    </form>
  )
}

export function RemoveWishlistButton({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(toggleWishlistAction, {} as ActionState)
  return (
    <form action={action}>
      <input type="hidden" name="productId" value={productId} />
      <Button
        type="submit"
        variant="ghost"
        disabled={pending}
        className="px-2 py-1 text-sm text-danger-700"
      >
        <Icon name="trash" size={16} /> Remove
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-danger-700">
          {state.error}
        </span>
      )}
    </form>
  )
}

export function ProfileForm({ displayName }: { displayName: string }) {
  return (
    <ActionForm action={updateProfileAction} submitLabel="Save name" pendingLabel="Saving…">
      <Input
        label="Display name"
        name="displayName"
        defaultValue={displayName}
        maxLength={80}
        required
      />
    </ActionForm>
  )
}

export function PlaceForm({
  points,
  place,
}: {
  points: { id: string; label: string }[]
  place?: SavedPlace
}) {
  return (
    <ActionForm
      action={savePlaceAction}
      submitLabel={place ? 'Update place' : 'Save place'}
      pendingLabel="Saving…"
    >
      {place && <input type="hidden" name="id" value={place.id} />}
      <Input
        label="Name for this place"
        name="label"
        defaultValue={place?.label ?? ''}
        maxLength={40}
        required
        placeholder="For example: My hostel"
      />
      <Select
        label="Delivery point"
        name="point"
        required
        defaultValue={place?.delivery_point_id ?? points[0]?.id}
      >
        {points.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <Checkbox
        label="Use this as my default"
        name="default"
        defaultChecked={place?.is_default ?? false}
      />
    </ActionForm>
  )
}

export function DeletePlaceButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deletePlaceAction, {} as ActionState)
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        disabled={pending}
        className="px-2 py-1 text-sm text-danger-700"
      >
        <Icon name="trash" size={16} /> Remove
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-danger-700">
          {state.error}
        </span>
      )}
    </form>
  )
}
