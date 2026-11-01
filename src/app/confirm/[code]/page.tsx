import type { Metadata } from 'next'
import Link from 'next/link'
import { ActionForm } from '@/components/forms/action-form'
import { Alert } from '@/components/ui/alert'
import { Card, PageHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { confirmDeliveryByQrAction } from '@/server/modules/orders-and-state-machine/qr-actions'

export const metadata: Metadata = { title: 'Confirm delivery' }

/** The page a customer lands on after scanning the rider's QR code. The code is `<order id>.<token>`. */
export default async function ConfirmByQr({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const [orderId = '', token = ''] = decodeURIComponent(code).split('.')
  const sb = await createSupabaseServerClient()
  const { data: order } = await sb
    .from('orders')
    .select('id, order_number, status, total_kobo, vendor_name, delivery_point_label')
    .eq('id', orderId)
    .maybeSingle()
  const ready = order && ['ARRIVAL_DETECTED', 'AWAITING_RECIPIENT_PROOF'].includes(order.status)
  return (
    <>
      <PageHeader
        title="Confirm you received your order"
        breadcrumbs={[{ label: 'Orders', href: '/orders' }, { label: 'Confirm delivery' }]}
      />
      {!order ? (
        <Alert tone="danger" title="We could not find that order">
          Make sure you are signed in as the person who placed it, then scan the code again.
        </Alert>
      ) : !ready ? (
        <Alert tone="info" title="Nothing to confirm right now">
          This order is not waiting for a hand-over confirmation.{' '}
          <Link className="font-semibold underline" href={`/orders/${order.id}`}>
            Go to the order
          </Link>
        </Alert>
      ) : (
        <Card className="max-w-xl space-y-3">
          <p className="font-semibold">
            Order {order.order_number} · {order.vendor_name}
          </p>
          <p className="text-sm">
            <strong>Delivered to:</strong> {order.delivery_point_label ?? ''}
          </p>
          <p className="text-sm">
            <strong>Total:</strong> <Money kobo={order.total_kobo} />
          </p>
          <ActionForm
            action={confirmDeliveryByQrAction}
            submitLabel="Yes, I received my order"
            pendingLabel="Confirming…"
            variant="gold"
          >
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="token" value={token} />
            <Checkbox
              label="I have my order and everything is correct. I understand this ends the delivery."
              name="confirm"
              required
            />
          </ActionForm>
          <p className="text-sm">
            Something missing or wrong? Do not confirm.{' '}
            <Link
              className="font-semibold text-brand-700 underline"
              href={`/orders/${order.id}/help`}
            >
              Get help from support
            </Link>
            .
          </p>
        </Card>
      )}
    </>
  )
}
