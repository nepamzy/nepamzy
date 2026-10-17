import type { Metadata } from 'next'
import {
  BANK_NOTE,
  statusHelp,
  History,
  ReceiptCard,
  StatusBadge,
} from '@/components/domain/delivery-fee-view'
import { RiderBankForm, RiderRespondForm } from '@/components/domain/delivery-fee-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { myDeliveryFeePayments, myRiderBankDetails } from '@/server/modules/delivery-fee/queries'

export const metadata: Metadata = { title: 'Rider payments' }

export default async function RiderPayments() {
  const [bank, payments] = await Promise.all([myRiderBankDetails(), myDeliveryFeePayments()])
  const mine = payments.filter((p) => p.viewer === 'rider')
  return (
    <>
      <PageHeader title="Payments" subtitle="Delivery fees paid to you directly by bank transfer" />
      <Card className="mb-5 max-w-xl space-y-1">
        <p className="font-semibold">Rider earnings: Free of charge.</p>
        <p className="font-semibold">Delivery commission features: Coming Soon</p>
        <p className="text-sm text-muted">
          AFIT Market takes no commission from riders. When a delivery fee is not collected with the
          online payment, the customer pays you directly and you confirm when it arrives.
        </p>
      </Card>
      <section aria-labelledby="bank" className="mb-6 max-w-xl space-y-3">
        <h2 id="bank" className="text-lg font-bold">
          Your bank details
        </h2>
        {bank?.set ? (
          <p>
            {bank.bank_name} · {bank.account_name} · <strong>{bank.account_masked}</strong>
          </p>
        ) : (
          <p className="font-medium text-warning-700">
            No bank details yet. Customers cannot pay a delivery fee to you until you add them.
          </p>
        )}
        <Card className="space-y-2">
          <p className="text-sm text-muted">
            Changing these affects only future payments. Payments already opened keep the details
            the customer was shown.
          </p>
          <RiderBankForm defaults={bank?.set ? bank : undefined} />
        </Card>
      </section>
      <section aria-labelledby="pay" className="max-w-xl space-y-3">
        <h2 id="pay" className="text-lg font-bold">
          Delivery fee payments
        </h2>
        {mine.length === 0 ? (
          <p className="text-muted">No direct delivery fee payments yet.</p>
        ) : (
          <ul className="space-y-4">
            {mine.map((p) => (
              <li key={p.id}>
                <Card className="space-y-3">
                  <p className="flex flex-wrap items-center gap-2">
                    <strong>{p.order_number}</strong> · <Money kobo={p.amount_kobo} /> ·{' '}
                    <StatusBadge status={p.status} />
                  </p>
                  <p className="text-sm text-muted">{statusHelp(p.status, 'rider')}</p>
                  {p.status === 'customer_reported' && (
                    <>
                      <p className="font-medium">
                        {p.customer_name} says they sent {<Money kobo={p.amount_kobo} />} to{' '}
                        {p.bank_name}. Check your own bank account before answering.
                      </p>
                      {p.customer_note && (
                        <p className="text-sm">Their note: “{p.customer_note}”</p>
                      )}
                      <RiderRespondForm paymentId={p.id} />
                    </>
                  )}
                  {p.receipt && <ReceiptCard p={p} />}
                  <History items={p.history ?? []} />
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">{BANK_NOTE}</p>
      </section>
    </>
  )
}
