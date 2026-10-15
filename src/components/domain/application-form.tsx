import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/fields'
import { submitApplicationAction } from '@/server/modules/vendors-and-catalogue/actions'
import type { Category } from '@/server/modules/vendors-and-catalogue/types'

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`

export function ApplicationForm({
  categories,
  commissionBps,
}: {
  categories: Category[]
  commissionBps: number
}) {
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
      <p
        id="commission-terms"
        className="rounded-[var(--radius-control)] bg-brand-50 px-3 py-2 text-sm"
      >
        <strong>Commission:</strong> AFIT Market keeps {pct(commissionBps)} of the product value of
        each completed order (after any product discount). Delivery fees are not included. If part
        of an order is refunded, the commission on that part is returned to you. You can see every
        order&apos;s commission on your Earnings page. No payout is enabled yet.
      </p>
      <Checkbox
        label={`I agree to follow AFIT Market vendor rules, to keep my menu and prices accurate, and to the ${pct(commissionBps)} commission described above.`}
        name="accept"
        aria-describedby="commission-terms"
        required
      />
    </ActionForm>
  )
}
