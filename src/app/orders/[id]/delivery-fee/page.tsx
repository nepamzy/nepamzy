import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  BANK_NOTE,
  statusHelp,
  History,
  ReceiptCard,
  StatusBadge,
} from '@/components/domain/delivery-fee-view'
import {
  CopyButton,
  OpenDeliveryFeeForm,
  ReportTransferForm,
} from '@/components/domain/delivery-fee-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { deliveryFeeForOrder } from '@/server/modules/delivery-fee/queries'

export const metadata: Metadata = { title: 'Pay delivery fee' }

export default async function PayDeliveryFee({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await deliveryFeeForOrder(id)
  if (!v) notFound()
  return (
    <>
      <p className="mb-2">
        <Link href={`/orders/${id}`} className="font-semibold text-brand-700 underline">
          ← Back to the order
        </Link>
      </p>
      <PageHeader title="Pay Delivery Fee" subtitle={v.order_number} />
      {v.state === 'payment' ? (
        <div className="max-w-xl space-y-4">
          <Card className="space-y-3">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge status={v.status} />
              <span className="text-sm text-muted">{statusHelp(v.status, 'customer')}</span>
            </p>
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <dt className="font-semibold">Order</dt>
              <dd>{v.order_number}</dd>
              <dt className="font-semibold">Rider</dt>
              <dd>{v.rider_name}</dd>
              <dt className="font-semibold">Delivery fee</dt>
              <dd>
                <Money kobo={v.amount_kobo} className="font-bold" />
              </dd>
              <dt className="font-semibold">Bank</dt>
              <dd>{v.bank_name}</dd>
              <dt className="font-semibold">Account name</dt>
              <dd>{v.account_name}</dd>
              <dt className="font-semibold">Account number</dt>
              <dd className="text-xl font-bold tracking-wider">
                {v.account_number ?? (
                  <span className="text-base font-medium text-warning-700">
                    Not available right now. Please try again later or contact support.
                  </span>
                )}
              </dd>
            </dl>
            <p className="flex flex-wrap items-center gap-2">
              {v.account_number && (
                <CopyButton value={v.account_number} label="Copy account number" />
              )}
            </p>
            <p className="text-sm text-muted">
              Rider photo: not available yet. Payment evidence upload: not available yet; only your
              report below is recorded.
            </p>
          </Card>
          {v.status === 'awaiting_transfer' && (
            <Card className="space-y-3">
              <h2 className="text-lg font-bold">How to pay</h2>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open your bank app and send exactly the amount above to this account.</li>
                <li>Come back here and choose “I have made this transfer”.</li>
                <li>The rider checks their own account and confirms. You then get a receipt.</li>
              </ol>
              <ReportTransferForm paymentId={v.id} />
            </Card>
          )}
          {v.status === 'customer_reported' && (
            <p role="status" className="font-medium">
              You said this was sent. We are waiting for the rider to confirm.
            </p>
          )}
          {v.status === 'rider_disputed' && (
            <p role="status" className="font-medium text-danger-700">
              The rider says the money did not arrive. An administrator will review it; you do not
              need to pay again unless you are told to.
            </p>
          )}
          {v.receipt && <ReceiptCard p={v} />}
          <p className="text-sm text-muted">{BANK_NOTE}</p>
          <History items={v.history ?? []} />
        </div>
      ) : v.state === 'ready_to_open' ? (
        <Card className="max-w-xl space-y-3">
          <p>
            The delivery fee of <Money kobo={v.amount_kobo ?? 0} className="font-bold" /> was not
            part of your online payment. You pay it directly to the rider{' '}
            {v.rider_name ? <strong>{v.rider_name}</strong> : null} by bank transfer.
          </p>
          <OpenDeliveryFeeForm orderId={id} />
        </Card>
      ) : (
        <EmptyState
          title={
            v.state === 'not_applicable'
              ? 'Nothing to pay the rider'
              : v.state === 'not_ready'
                ? 'Not ready yet'
                : v.state === 'rider_details_missing'
                  ? 'Payment details are not ready'
                  : 'We need to check this order'
          }
        >
          {v.state === 'not_applicable'
            ? 'The delivery fee for this order is not paid directly to a rider.'
            : v.state === 'not_ready'
              ? 'This opens after the order is paid and delivered.'
              : v.state === 'rider_details_missing'
                ? 'The rider has not added bank details yet. Please check again later. You have not been charged.'
                : 'Our records for this order do not clearly show whether the delivery fee was already paid, so you are not being asked to pay it. Support will review it.'}
        </EmptyState>
      )}
    </>
  )
}
