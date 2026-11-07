'use client'
import { useState } from 'react'
import { Input } from '@/components/ui/fields'

export type VendorType = 'student' | 'afit_shop' | 'other'
export type CategoryChoice = { id: string; name: string; slug: string }
export type VendorChoicesState = {
  vendorType: VendorType | ''
  categories: string[]
  other: string
  place: string
}

const TYPES: { value: VendorType; title: string; text: string }[] = [
  { value: 'student', title: 'AFIT student', text: 'You study at AFIT and sell as a student.' },
  {
    value: 'afit_shop',
    title: 'Shop already verified by AFIT',
    text: 'You already have a real, physical shop on the AFIT campus.',
  },
  { value: 'other', title: 'Other', text: 'Anyone else who sells to the campus community.' },
]

/** True when the vendor choices are complete enough to go on. */
export const vendorChoicesReady = (s: VendorChoicesState, categories: CategoryChoice[]) => {
  const other = categories.find((c) => c.slug === 'other')
  return (
    s.vendorType !== '' &&
    s.categories.length > 0 &&
    (!other || !s.categories.includes(other.id) || s.other.trim().length >= 3) &&
    (s.vendorType !== 'afit_shop' || s.place.trim().length >= 3)
  )
}

/**
 * Who the vendor is, and what the shop sells: several categories can be ticked (the first one in the list is the main one), and
 * "Other" lets the vendor type a category we did not think of. Used on the sign-up page and on the vendor application.
 * It sends the choices as ordinary form fields: vendorType, category (many), otherCategory and shopPlace.
 */
export function VendorChoices({
  categories,
  defaults,
  onChange,
  showStudentNote,
}: {
  categories: CategoryChoice[]
  defaults?: Partial<VendorChoicesState>
  onChange?: (s: VendorChoicesState) => void
  /** on the application page a student's matric number comes from the account */
  showStudentNote?: boolean
}) {
  const [s, setS] = useState<VendorChoicesState>({
    vendorType: defaults?.vendorType ?? '',
    categories: defaults?.categories ?? [],
    other: defaults?.other ?? '',
    place: defaults?.place ?? '',
  })
  const set = (patch: Partial<VendorChoicesState>) => {
    const next = { ...s, ...patch }
    setS(next)
    onChange?.(next)
  }
  const otherCat = categories.find((c) => c.slug === 'other')
  const otherTicked = !!otherCat && s.categories.includes(otherCat.id)
  const toggle = (id: string, on: boolean) =>
    set({ categories: on ? [...s.categories, id] : s.categories.filter((x) => x !== id) })
  return (
    <div className="space-y-4" data-testid="vendor-choices">
      <input type="hidden" name="vendorType" value={s.vendorType} />
      {s.categories.map((id) => (
        <input key={id} type="hidden" name="category" value={id} />
      ))}
      {otherTicked && <input type="hidden" name="otherCategory" value={s.other} />}
      {s.vendorType === 'afit_shop' && <input type="hidden" name="shopPlace" value={s.place} />}

      <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
        <legend className="px-1 text-sm font-bold text-navy-900">I am a (required)</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label
              key={t.value}
              className="touch-target relative flex cursor-pointer flex-col gap-1 rounded-[var(--radius-control)] border-2 border-line bg-white p-3 transition hover:border-brand-600 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold-400/60"
            >
              <input
                type="radio"
                name="vendor-type-choice"
                value={t.value}
                checked={s.vendorType === t.value}
                onChange={() => set({ vendorType: t.value })}
                className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
              />
              <span className="font-bold text-navy-900">{t.title}</span>
              <span className="text-sm text-muted">{t.text}</span>
            </label>
          ))}
        </div>
        {s.vendorType === 'afit_shop' && (
          <div className="mt-3">
            <Input
              label="Where is your shop on campus?"
              value={s.place}
              maxLength={120}
              onChange={(e) => set({ place: e.target.value })}
              hint="For example: beside the main gate. We check it before approving."
            />
          </div>
        )}
        {s.vendorType === 'student' && showStudentNote && (
          <p className="mt-2 text-sm text-muted">
            Your matric number is kept on your account. You can add or change it under Account, then
            Security.
          </p>
        )}
      </fieldset>

      <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
        <legend className="px-1 text-sm font-bold text-navy-900">
          What will your shop sell? (required, tick all that fit)
        </legend>
        <p className="mb-2 text-sm text-muted">
          The first one you tick is your main category. Pick &quot;Other&quot; if yours is not here
          and tell us in your own words.
        </p>
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {categories.map((c) => (
            <li key={c.id}>
              <label className="touch-target flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--color-brand-700)]"
                  checked={s.categories.includes(c.id)}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {otherTicked && (
          <div className="mt-3">
            <Input
              label="What else will you sell?"
              value={s.other}
              maxLength={60}
              onChange={(e) => set({ other: e.target.value })}
              hint="For example: handmade bead jewellery."
            />
          </div>
        )}
      </fieldset>
    </div>
  )
}
