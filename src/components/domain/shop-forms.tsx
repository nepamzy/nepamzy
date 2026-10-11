import { ActionForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/fields'
import {
  addStaffAction,
  removeStaffAction,
  saveHoursAction,
  saveProfileAction,
} from '@/server/modules/vendors-and-catalogue/actions'
import { WEEKDAYS, hoursByDay } from '@/server/modules/vendors-and-catalogue/hours'

type Vendor = {
  id: string
  description: string | null
  contact_phone: string | null
  pickup_location_text: string | null
  prep_minutes: number
}

export function ProfileForm({ vendor, disabled }: { vendor: Vendor; disabled: boolean }) {
  return (
    <ActionForm action={saveProfileAction} submitLabel="Save profile" hideSubmit={disabled}>
      <input type="hidden" name="vendorId" value={vendor.id} />
      <fieldset disabled={disabled} className="space-y-4">
        <Textarea
          label="About your shop"
          name="description"
          defaultValue={vendor.description ?? ''}
          maxLength={500}
        />
        <Input
          label="Contact phone"
          name="phone"
          type="tel"
          defaultValue={vendor.contact_phone ?? ''}
          hint="Visible to administrators only."
        />
        <Input
          label="Pickup spot"
          name="pickup"
          defaultValue={vendor.pickup_location_text ?? ''}
          maxLength={200}
          hint="Describe it in words. Do not enter coordinates."
        />
        <Input
          label="Typical preparation time (minutes)"
          name="prep"
          type="number"
          min={1}
          max={240}
          defaultValue={vendor.prep_minutes}
        />
      </fieldset>
    </ActionForm>
  )
}

export function HoursForm({
  vendorId,
  hours,
  disabled,
}: {
  vendorId: string
  hours: { weekday: number; opens: string; closes: string }[]
  disabled: boolean
}) {
  const byDay = hoursByDay(hours)
  return (
    <ActionForm action={saveHoursAction} submitLabel="Save opening hours" hideSubmit={disabled}>
      <input type="hidden" name="vendorId" value={vendorId} />
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="text-sm text-muted">
          Times are Nigeria time (WAT), 24-hour clock. Tick a day to open it. A second range is
          optional (for a lunch break).
        </legend>
        {WEEKDAYS.map((d, i) => {
          const r = byDay[i] ?? []
          return (
            <div
              key={d}
              className="grid items-end gap-2 border-b border-line pb-3 sm:grid-cols-[8rem_repeat(4,6.5rem)]"
            >
              <label className="touch-target flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  name={`d${i}_open`}
                  defaultChecked={r.length > 0}
                  className="size-5 accent-[var(--color-brand-700)]"
                />
                {d}
              </label>
              <Input
                label="Opens"
                name={`d${i}_from`}
                type="time"
                defaultValue={r[0]?.from ?? '08:00'}
              />
              <Input
                label="Closes"
                name={`d${i}_to`}
                type="time"
                defaultValue={r[0]?.to ?? '18:00'}
              />
              <Input
                label="Reopens"
                name={`d${i}_from2`}
                type="time"
                defaultValue={r[1]?.from ?? ''}
              />
              <Input
                label="Closes again"
                name={`d${i}_to2`}
                type="time"
                defaultValue={r[1]?.to ?? ''}
              />
            </div>
          )
        })}
      </fieldset>
    </ActionForm>
  )
}

export function StaffSection({
  vendorId,
  staff,
  isOwner,
  disabled,
}: {
  vendorId: string
  staff: { user_id: string; staff_role: string }[]
  isOwner: boolean
  disabled: boolean
}) {
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {staff.map((s) => (
          <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {s.staff_role === 'owner' ? 'Owner' : 'Staff member'}{' '}
              <span className="font-mono text-xs text-muted">{s.user_id.slice(0, 8)}</span>
            </span>
            {isOwner && s.staff_role === 'staff' && !disabled && (
              <form action={removeStaffAction}>
                <input type="hidden" name="vendorId" value={vendorId} />
                <input type="hidden" name="userId" value={s.user_id} />
                <Button type="submit" variant="ghost">
                  Remove
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {isOwner && !disabled ? (
        <ActionForm action={addStaffAction} submitLabel="Add staff member" pendingLabel="Adding…">
          <input type="hidden" name="vendorId" value={vendorId} />
          <Input
            label="Staff member’s email"
            name="email"
            type="email"
            required
            hint="They must already have an AFIT Market account. Staff can manage the menu but not the shop profile, hours or other staff."
          />
        </ActionForm>
      ) : (
        <p className="text-sm text-muted">Only the owner can add or remove staff.</p>
      )}
    </div>
  )
}
