import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AutoRefresh } from '@/components/domain/auto-refresh'
import { DeliveryProofPanel } from '@/components/domain/delivery-proof-panel'
import { OrderStatusPill, ORDER_STATES } from '@/components/domain/order-status'
import { OrderTracking } from '@/components/domain/order-tracking'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { Timeline } from '@/components/ui/timeline'
import { ReviewForm } from '@/components/domain/engagement-forms'
import { myOrderReview } from '@/server/modules/engagement/queries'
import { deliveryFeeForOrder } from '@/server/modules/delivery-fee/queries'
import { ActionForm } from '@/components/forms/action-form'
import { mockPaymentsAllowed, paystackConfig } from '@/lib/env'
import { cancelOrderAction, mockPayAction } from '@/server/modules/cart-and-checkout/actions'
import { payWithPaystackAction } from '@/server/modules/payments/actions'
import {
  getOrder,
  getPickupCode,
  listPaymentTransactions,
} from '@/server/modules/orders-and-state-machine/queries'

export const metadata: Metadata = { title: 'Order' }

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await getOrder((await params).id)
  if (!found) notFound()
  const { order, items, history, payments } = found
  const unpaid = order.status === 'PENDING_PAYMENT'
  const paystack = paystackConfig() !== null
  const pickup = order.status === 'PICKUP_AWAITING_HANDOVER' ? await getPickupCode(order.id) : null
  const txns = await listPaymentTransactions(order.id)
  const review = ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(order.status)
    ? await myOrderReview(order.id)
    : null
  const dfp = order.fulfilment === 'delivery' ? await deliveryFeeForOrder(order.id) : null
  const hasReceipt = !['PENDING_PAYMENT', 'CANCELLED'].includes(order.status)
  const label = (c: string) => ORDER_STATES.find((s) => s.code === c)?.label ?? c
  const settled = ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(
    order.status,
  )
  return (
    <>
      {!settled && <AutoRefresh />}
      <PageHeader
        title={order.order_number}
        subtitle={`${order.vendor_name} · ${order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}`}
        actions={<OrderStatusPill code={order.status} />}
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Orders', href: '/orders' },
          { label: order.order_number },
        ]}
      />
      <Alert tone="info" className="mb-5">
        {ORDER_STATES.find((s) => s.code === order.status)?.meaning}
      </Alert>

      {unpaid && (
        <Card className="mb-5 space-y-3 border-2 border-gold-400 bg-accent-50/50">
          <h2 className="text-lg font-extrabold text-navy-900">Payment needed</h2>
          <p>
            Total to pay: <Money kobo={order.total_kobo} className="font-bold" />
            {order.expires_at && (
              <span className="text-sm text-muted">
                {' '}
                · hold ends{' '}
                {new Date(order.expires_at).toLocaleTimeString('en-NG', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            {paystack && (
              <ActionForm
                action={payWithPaystackAction}
                submitLabel="Pay with Paystack (test mode)"
                pendingLabel="Opening payment…"
              >
                <input type="hidden" name="orderId" value={order.id} />
              </ActionForm>
            )}
            {mockPaymentsAllowed() ? (
              <form action={mockPayAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit">Pay (test only, no real money)</Button>
              </form>
            ) : (
              !paystack && (
                <p className="font-medium text-warning-700">Online payment is not open yet.</p>
              )
            )}
            <form action={cancelOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <Button type="submit" variant="secondary">
                Cancel order
              </Button>
            </form>
          </div>
          {mockPaymentsAllowed() && (
            <p className="text-xs text-muted">
              <Badge tone="warning">Test mode</Badge> This is a rehearsal. Real card payment arrives
              in a later release.
            </p>
          )}
        </Card>
      )}

      {dfp && dfp.state !== 'not_applicable' && (
        <Card className="mb-5 space-y-2 border-brand-700">
          <h2 className="text-lg font-extrabold text-navy-900">
            Delivery fee
            {dfp.state === 'payment' && dfp.status === 'awaiting_transfer' && (
              <Badge tone="warning" className="ml-2">
                To do
              </Badge>
            )}
          </h2>
          <p>
            {dfp.state === 'payment'
              ? dfp.status === 'awaiting_transfer'
                ? 'Your order was delivered. Send the delivery fee straight to your rider by bank transfer.'
                : 'You pay this delivery fee directly to your rider by bank transfer. Open it to see where things stand.'
              : dfp.state === 'ready_to_open'
                ? 'The delivery fee was not part of your online payment. You pay it to your rider by bank transfer.'
                : dfp.state === 'rider_details_missing'
                  ? 'Your rider has not added bank details yet. This page updates when they do; you have not been charged.'
                  : 'You will pay the delivery fee to your rider by bank transfer after your order is delivered. It is not part of the online payment, and a button appears here when it is time.'}
          </p>
          {(dfp.state === 'payment' || dfp.state === 'ready_to_open') && (
            <Link
              href={`/orders/${order.id}/delivery-fee`}
              className="inline-block font-semibold text-brand-700 underline"
            >
              Pay Delivery Fee
            </Link>
          )}
        </Card>
      )}

      {pickup && (
        <Card className="mb-5 space-y-2 border-brand-700">
          <h2 className="text-lg font-extrabold text-navy-900">Your pickup code</h2>
          <p
            className="text-3xl font-bold tracking-widest"
            aria-label={`Pickup code ${pickup.code.split('').join(' ')}`}
          >
            {pickup.code}
          </p>
          <p className="text-sm text-muted">
            Show this code to the vendor when you collect your order, then sign for it. Do not share
            it with anyone else.
          </p>
        </Card>
      )}

      {order.fulfilment === 'delivery' &&
        ['RIDER_ASSIGNED', 'PICKED_UP_BY_RIDER', 'EN_ROUTE', 'ARRIVAL_DETECTED'].includes(
          order.status,
        ) && (
          <Card className="mb-5 space-y-2">
            <h2 className="text-lg font-extrabold text-navy-900">Delivery tracking</h2>
            <OrderTracking orderId={order.id} mapKey={process.env.ARCGIS_API_KEY ?? null} />
          </Card>
        )}

      {order.fulfilment === 'delivery' &&
        ['ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF'].includes(order.status) && (
          <Card className="mb-5 border-brand-700">
            <DeliveryProofPanel
              orderId={order.id}
              orderNumber={order.order_number}
              vendorName={order.vendor_name}
              deliverTo={order.delivery_point_label ?? ''}
              totalKobo={order.total_kobo}
              items={items.map((i) => ({
                id: i.id,
                name: i.product_name,
                quantity: i.quantity,
                lineKobo: i.line_total_kobo,
              }))}
              helpHref={`/orders/${order.id}/help`}
            />
          </Card>
        )}

      {review?.can_review && (
        <Card className="mb-5 space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">Review this order</h2>
          <ReviewForm orderId={order.id} />
        </Card>
      )}
      {review?.review && (
        <Card className="mb-5 space-y-1">
          <h2 className="text-lg font-extrabold text-navy-900">Your review</h2>
          <p aria-label={`${review.review.rating} out of 5`}>{'★'.repeat(review.review.rating)}</p>
          {review.review.comment && <p>{review.review.comment}</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="space-y-3">
          <h2 className="text-lg font-extrabold text-navy-900">Items</h2>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>
                  {i.quantity} × {i.product_name}
                  {i.options.length > 0 && (
                    <span className="block text-sm text-muted">
                      {i.options.map((o) => o.name).join(', ')}
                    </span>
                  )}
                </span>
                <Money kobo={i.line_total_kobo} />
              </li>
            ))}
          </ul>
          <hr className="border-line" />
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd>
                <Money kobo={order.items_total_kobo} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>
                Delivery
                {order.delivery_fee_collection === 'direct_to_rider' &&
                  ' (paid directly to your rider, not part of the total below)'}
              </dt>
              <dd>
                <Money kobo={order.delivery_fee_kobo} />
              </dd>
            </div>
            {order.platform_fee_kobo > 0 && (
              <div className="flex justify-between">
                <dt>Service fee (charged on earlier orders; no longer applied)</dt>
                <dd>
                  <Money kobo={order.platform_fee_kobo} />
                </dd>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold">
              <dt>
                {order.delivery_fee_collection === 'direct_to_rider'
                  ? 'Total paid online'
                  : 'Total'}
              </dt>
              <dd>
                <Money kobo={order.total_kobo} />
              </dd>
            </div>
          </dl>
          {order.fulfilment === 'delivery' ? (
            <p className="text-sm">
              <strong>Deliver to:</strong> {order.delivery_point_label}
            </p>
          ) : (
            <p className="text-sm">
              <strong>Collect from:</strong> {order.pickup_location_snapshot ?? order.vendor_name}
              {order.prep_minutes_snapshot
                ? ` · ready in about ${order.prep_minutes_snapshot} min`
                : ''}
            </p>
          )}
          {hasReceipt && (
            <p className="text-sm">
              <Link
                className="font-semibold text-brand-700 underline"
                href={`/orders/${order.id}/help`}
              >
                Problem with this order? Report it, or ask for a refund or return
              </Link>
            </p>
          )}
          {hasReceipt && (
            <p className="text-sm">
              <a
                className="font-semibold text-brand-700 underline"
                href={`/orders/${order.id}/receipt`}
              >
                Download receipt (PDF)
              </a>
            </p>
          )}
          {txns.length > 0 && (
            <p className="text-sm text-muted">
              Card payment (test mode): {txns.map((t) => t.status).join(', ')}
            </p>
          )}
          {payments.length > 0 && (
            <p className="text-sm text-muted">
              Payment:{' '}
              {payments
                .map((p) => `${p.provider === 'mock' ? 'Test payment' : p.provider} ${p.status}`)
                .join(', ')}
            </p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-extrabold text-navy-900">Order timeline</h2>
          <Timeline
            steps={history.map((h, i) => ({
              label: label(h.to_status),
              detail: new Date(h.created_at).toLocaleString('en-NG'),
              state: i === history.length - 1 ? 'current' : 'done',
            }))}
          />
        </Card>
      </div>
    </>
  )
}
