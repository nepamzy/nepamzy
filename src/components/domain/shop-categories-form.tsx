import { ActionForm } from '@/components/forms/action-form'
import { Input, Select } from '@/components/ui/fields'
import { saveShopCategoriesAction } from '@/server/modules/vendors-and-catalogue/actions'
import type { Category } from '@/server/modules/vendors-and-catalogue/types'

/** The shop owner changes what the shop sells: one main category, any others it also sells, and an own-words "other". */
export function ShopCategoriesForm({
  vendorId,
  categories,
  mainId,
  selectedIds,
  other,
}: {
  vendorId: string
  categories: Category[]
  mainId: string | null
  selectedIds: string[]
  other: string
}) {
  const hasOther = categories.find((c) => c.slug === 'other')
  return (
    <ActionForm
      action={saveShopCategoriesAction}
      submitLabel="Save categories"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="vendorId" value={vendorId} />
      <Select label="Main category" name="main" required defaultValue={mainId ?? ''}>
        <option value="" disabled>
          Choose one
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
        <legend className="px-1 text-sm font-bold text-navy-900">Also sells</legend>
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {categories.map((c) => (
            <li key={c.id}>
              <label className="touch-target flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="checkbox"
                  name="extra"
                  value={c.id}
                  defaultChecked={selectedIds.includes(c.id) && c.id !== mainId}
                  className="size-5 accent-[var(--color-brand-700)]"
                />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {hasOther && (
        <Input
          label="Something else? Say it in your own words"
          name="otherCategory"
          maxLength={60}
          defaultValue={other}
          hint='Only used with the "Other" category, for example: handmade bead jewellery.'
        />
      )}
    </ActionForm>
  )
}
