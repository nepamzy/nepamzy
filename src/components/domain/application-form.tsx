import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/fields'
import { submitApplicationAction } from '@/server/modules/vendors-and-catalogue/actions'
import type { Category } from '@/server/modules/vendors-and-catalogue/types'

export function ApplicationForm({ categories }: { categories: Category[] }) {
  return (
    <ActionForm
      action={submitApplicationAction}
      submitLabel="Submit application"
      pendingLabel="Sending…"
    >
      <Input label="Business name" name="businessName" required minLength={2} maxLength={80} />
      <Select label="Category" name="category" required defaultValue="">
        <option value="" disabled>
          Choose one
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Input
        label="Contact phone"
        name="phone"
        type="tel"
        required
        inputMode="tel"
        hint="Used only by administrators to reach you."
      />
      <Textarea
        label="What do you sell?"
        name="description"
        required
        minLength={10}
        maxLength={500}
      />
      <Input
        label="Where will customers collect orders?"
        name="pickup"
        required
        minLength={3}
        maxLength={200}
        hint="Describe the pickup spot in words. Do not enter coordinates."
      />
      <Checkbox
        label="I agree to follow AFIT Market vendor rules and to keep my menu and prices accurate."
        name="accept"
        required
      />
    </ActionForm>
  )
}
