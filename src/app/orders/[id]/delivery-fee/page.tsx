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
import { Alert } from '@/components/ui/alert'
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
      <PageHeader
        breadcrumbs={[
          { label: 'Orders', href: '/orders' },
          { label: v.order_number, href: `/orders/${id}` },
          { label: 'Pay delivery fee' },
        ]}
        title="Pay Delivery Fee"
        subtitle={`Order ${v.order_number}: sent straight to your rider by bank transfer`}
      />
      {v.state === 'payment' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="space-y-4">
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge status={v.status} />
                <span className="text-sm text-muted">{statusHelp(v.status, 'customer')}</span>
              </p>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-12 place-items-center rounded-full bg-navy-900 text-lg font-extrabold text-gold-400"
                >
                  {v.rider_name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm text-muted">Your rider</p>
                  <p className="text-lg font-bold text-navy-900">{v.rider_name}</p>
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] bg-surface p-4">
                <p className="text-sm text-muted">Delivery fee to send</p>
                <p className="text-3xl font-extrabold text-navy-900">
                  <Money kobo={v.amount_kobo} />
                </p>
                <p className="text-sm text-muted">
                  This is the fee on your order. It was not part of your online payment.
                </p>
              </div>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
                <dt className="font-semibold">Order</dt>
                <dd>{v.order_number}</dd>
                <dt className="font-semibold">Bank</dt>
                <dd>{v.bank_name}</dd>
                <dt className="font-semibold">Account name</dt>
                <dd>{v.account_name}</dd>
                <dt className="font-semibold">Account number</dt>
                <dd className="text-2xl font-extrabold tracking-wider text-navy-900">
                  {v.account_number ?? (
                    <span className="text-base font-medium text-warning-700">
                      Not available right now. Please try again later or contact support.
                    </span>
                  )}
                </dd>
              </dl>
              {v.account_number && (
                <p>
                  <CopyButton value={v.account_number} label="Copy account number" />
                </p>
              )}
              <p className="text-sm text-muted">
                Rider photo and payment evidence upload are not available yet. Only your own report
                below is recorded.
              </p>
            </Card>
            {v.receipt && <ReceiptCard p={v} />}
            <p className="text-sm text-muted">{BANK_NOTE}</p>
          </div>

          <div className="space-y-4">
            {v.status === 'awaiting_transfer' && (
              <Card className="space-y-4">
                <h2 className="text-lg font-extrabold text-navy-900">How to pay</h2>
                <ol className="space-y-3">
                  {[
                    'Open your bank app and send exactly the amount shown to this account.',
                    'Come back here and choose “I Have Made the Transfer”.',
                    'The rider checks their own account and confirms. You then get a receipt.',
                  ].map((t, i) => (
                    <li key={t} className="flex gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold-400 text-sm font-extrabold text-ink">
                        {i + 1}
                      </span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>
                <ReportTransferForm paymentId={v.id} />
                <p className="text-sm text-muted">
                  This only records that you say you sent it. It does not confirm or verify the
                  transfer; the rider does that by checking their own account.
                </p>
              </Card>
            )}
            {v.status === 'customer_reported' && (
              <Alert plain tone="info" title="Awaiting Rider Confirmation">
                You said this was sent. We are waiting for the rider to confirm. Nothing is marked
                as paid until they do.
              </Alert>
            )}
            {v.status === 'rider_disputed' && (
              <Alert tone="danger" title="The rider says the money did not arrive">
                An administrator will review it; you do not need to pay again unless you are told
                to.
              </Alert>
            )}
            <History items={v.history ?? []} />
          </div>
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
