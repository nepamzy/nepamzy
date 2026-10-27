import type { Metadata } from 'next'
import {
  BANK_NOTE,
  DFP_STATUS,
  History,
  ReceiptCard,
  StatusBadge,
} from '@/components/domain/delivery-fee-view'
import { ResolveDisputeForm, VoidReceiptForm } from '@/components/domain/delivery-fee-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { adminDeliveryFeePayments } from '@/server/modules/delivery-fee/queries'

export const metadata: Metadata = { title: 'Delivery fee payments' }

export default async function AdminDeliveryFeePayments() {
  const data = await adminDeliveryFeePayments()
  if (!data) return <p className="text-muted">These records could not be loaded.</p>
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Administration', href: '/admin' },
          { label: 'Delivery fee payments' },
        ]}
        title="Delivery fee payments"
        subtitle="Direct bank transfers from customers to riders. Nothing is paid or checked by AFIT Market."
      />
      <p className="mb-4 max-w-2xl text-sm text-muted">{BANK_NOTE}</p>
      {data.ambiguous_orders.length > 0 && (
        <Card className="mb-5 space-y-1 border-warning-700">
          <h2 className="text-lg font-extrabold text-navy-900">Orders with unclear records</h2>
          <p className="text-sm">
            These orders are marked as paying the rider directly, but the payment records disagree
            with that. The customer is not being asked to pay.
          </p>
          <ul className="list-disc pl-5">
            {data.ambiguous_orders.map((o) => (
              <li key={o.order_id}>{o.order_number}</li>
            ))}
          </ul>
        </Card>
      )}
      {data.payments.length === 0 ? (
        <p className="text-muted">No direct delivery fee payments yet.</p>
      ) : (
        <ul className="max-w-2xl space-y-4">
          {data.payments.map((p) => (
            <li key={p.id}>
              <Card className="space-y-3">
                <p className="flex flex-wrap items-center gap-2">
                  <strong>{p.order_number}</strong> · <Money kobo={p.amount_kobo} /> ·{' '}
                  <StatusBadge status={p.status} />
                </p>
                <p className="text-sm">
                  {p.customer_name} → {p.rider_name} · {p.bank_name} ·{' '}
                  {p.account_masked ?? '(erased)'}
                </p>
                <p className="text-sm text-muted">{DFP_STATUS[p.status].help}</p>
                {p.customer_note && <p className="text-sm">Customer note: “{p.customer_note}”</p>}
                {p.rider_note && <p className="text-sm">Rider note: “{p.rider_note}”</p>}
                {p.resolution_reason && (
                  <p className="text-sm">Decision reason: “{p.resolution_reason}”</p>
                )}
                {p.status === 'rider_disputed' && <ResolveDisputeForm paymentId={p.id} />}
                {p.receipt && (
                  <>
                    <ReceiptCard p={p} />
                    {p.receipt.status === 'issued' && <VoidReceiptForm receiptId={p.receipt.id} />}
                  </>
                )}
                <History items={p.history ?? []} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
