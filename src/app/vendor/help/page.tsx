import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/card'
import { Section } from '@/components/ui/section'

export const metadata: Metadata = { title: 'Vendor help' }

const STEPS: [string, string][] = [
  [
    'A customer pays',
    'Orders only reach you after payment. Unpaid orders are never shown as work to do. (This test version uses Paystack test mode, so no real money moves.)',
  ],
  [
    'You accept and prepare',
    'Open Orders, accept the order, then mark it prepared and ready. Customers see each step.',
  ],
  [
    'Handover',
    'For pickup, the customer shows a pickup code and signs. For delivery, the assigned rider shows a code on their phone; only hand the parcel to that person. Use Handover to confirm.',
  ],
  [
    'Returns and refunds',
    'If a customer reports a problem, support decides. Approved returns appear under Returns; confirm when the item arrives back.',
  ],
  [
    'Earnings',
    'Earnings shows what completed orders add up to after the commission. It is a calculation only: this version does not pay out money.',
  ],
]

export default function VendorHelp() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Shop', href: '/vendor' }, { label: 'Help' }]}
        title="Help for shops"
        subtitle="How an order moves through your shop, in plain words."
      />
      <Section title="How an order works" id="steps">
        <ol className="space-y-3">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <Card className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-400 font-extrabold text-ink">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-bold text-navy-900">{title}</span>
                  <span className="text-muted">{body}</span>
                </span>
              </Card>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Good to know" id="notes">
        <Card className="space-y-2">
          <p>
            <strong>Commission.</strong> AFIT Market keeps 4.5% of the product value of completed
            orders. Delivery fees are not part of it.
          </p>
          <p>
            <strong>Pausing.</strong> Use Pause orders on your dashboard if you cannot take new
            orders. Orders already paid still need to be handled.
          </p>
          <p>
            <strong>Photos.</strong> Item photos are not available yet because file storage has not
            been set up.
          </p>
          <p>
            <strong>Need a person?</strong> Contact{' '}
            <Link className="font-semibold text-brand-700 underline" href="/contact">
              support
            </Link>
            . For a problem with one order, open that order&apos;s report instead.
          </p>
          <p>
            <strong>Security.</strong> Manage your sign-in and two-step verification under{' '}
            <Link className="font-semibold text-brand-700 underline" href="/account/security">
              account security
            </Link>
            .
          </p>
        </Card>
      </Section>
    </>
  )
}
