import type { Metadata } from 'next'
import { ReceiptCard } from '@/components/domain/delivery-fee-view'
import { PageHeader } from '@/components/ui/card'
import { myDeliveryFeePayments } from '@/server/modules/delivery-fee/queries'

export const metadata: Metadata = { title: 'Delivery fee receipts' }

export default async function Receipts() {
  const rows = (await myDeliveryFeePayments()).filter((p) => p.receipt)
  return (
    <>
      <PageHeader
        title="Delivery fee receipts"
        subtitle="Receipts for delivery fees paid directly to a rider"
      />
      {rows.length === 0 ? (
        <p className="text-muted">You have no delivery fee receipts.</p>
      ) : (
        <ul className="max-w-xl space-y-4">
          {rows.map((p) => (
            <li key={p.id}>
              <ReceiptCard p={p} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
