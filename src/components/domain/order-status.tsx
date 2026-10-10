import { Badge, type Tone } from '@/components/ui/badge'

export type OrderState = {
  code: string
  label: string
  tone: Tone
  /** Plain-language meaning shown to customers. */
  meaning: string
  applies: 'both' | 'delivery' | 'pickup'
}

/** Vocabulary from the handoff pack; the real state machine arrives in Batch 3. */
export const ORDER_STATES: OrderState[] = [
  {
    code: 'PENDING_PAYMENT',
    label: 'Waiting for payment',
    tone: 'warning',
    meaning: 'Finish paying to place your order.',
    applies: 'both',
  },
  {
    code: 'PAID',
    label: 'Payment received',
    tone: 'info',
    meaning: 'We confirmed your payment.',
    applies: 'both',
  },
  {
    code: 'VENDOR_REVIEW',
    label: 'With the vendor',
    tone: 'info',
    meaning: 'The vendor is checking your order.',
    applies: 'both',
  },
  {
    code: 'ACCEPTED',
    label: 'Accepted',
    tone: 'info',
    meaning: 'The vendor accepted your order.',
    applies: 'both',
  },
  {
    code: 'PREPARING',
    label: 'Being prepared',
    tone: 'info',
    meaning: 'Your order is being prepared.',
    applies: 'both',
  },
  {
    code: 'READY',
    label: 'Ready',
    tone: 'success',
    meaning: 'Your order is ready.',
    applies: 'both',
  },
  {
    code: 'AWAITING_RIDER',
    label: 'Finding a rider',
    tone: 'warning',
    meaning: 'We are finding a rider for you.',
    applies: 'delivery',
  },
  {
    code: 'RIDER_ASSIGNED',
    label: 'Rider assigned',
    tone: 'info',
    meaning: 'A rider will collect your order.',
    applies: 'delivery',
  },
  {
    code: 'PICKED_UP_BY_RIDER',
    label: 'Picked up',
    tone: 'info',
    meaning: 'The rider has your order.',
    applies: 'delivery',
  },
  {
    code: 'EN_ROUTE',
    label: 'On the way',
    tone: 'brand',
    meaning: 'Your order is on its way.',
    applies: 'delivery',
  },
  {
    code: 'ARRIVAL_DETECTED',
    label: 'Rider nearby',
    tone: 'brand',
    meaning: 'The rider is at your delivery point.',
    applies: 'delivery',
  },
  {
    code: 'AWAITING_RECIPIENT_PROOF',
    label: 'Confirm receipt',
    tone: 'warning',
    meaning: 'Check your items and sign to confirm.',
    applies: 'delivery',
  },
  {
    code: 'DELIVERED',
    label: 'Delivered',
    tone: 'success',
    meaning: 'Your order was handed over.',
    applies: 'delivery',
  },
  {
    code: 'PICKUP_AWAITING_HANDOVER',
    label: 'Ready to collect',
    tone: 'warning',
    meaning: 'Show your code at the vendor to collect.',
    applies: 'pickup',
  },
  {
    code: 'COMPLETED',
    label: 'Completed',
    tone: 'success',
    meaning: 'All done. Your receipt is available.',
    applies: 'both',
  },
  {
    code: 'CANCELLED',
    label: 'Cancelled',
    tone: 'neutral',
    meaning: 'This order was cancelled.',
    applies: 'both',
  },
  {
    code: 'REFUND_PENDING',
    label: 'Refund pending',
    tone: 'warning',
    meaning: 'We are processing your refund.',
    applies: 'both',
  },
  {
    code: 'PARTIALLY_REFUNDED',
    label: 'Partly refunded',
    tone: 'info',
    meaning: 'Part of your order was refunded.',
    applies: 'both',
  },
  {
    code: 'REFUNDED',
    label: 'Refunded',
    tone: 'neutral',
    meaning: 'Your order was refunded.',
    applies: 'both',
  },
  {
    code: 'DISPUTED',
    label: 'Under review',
    tone: 'danger',
    meaning: 'Support is reviewing a problem with this order.',
    applies: 'both',
  },
  {
    code: 'RETURN_REQUESTED',
    label: 'Return requested',
    tone: 'warning',
    meaning: 'A return was requested.',
    applies: 'both',
  },
  {
    code: 'RETURN_IN_PROGRESS',
    label: 'Return in progress',
    tone: 'info',
    meaning: 'The item is being returned to the vendor.',
    applies: 'delivery',
  },
  {
    code: 'RETURNED_TO_VENDOR',
    label: 'Returned to vendor',
    tone: 'neutral',
    meaning: 'The vendor has the item back.',
    applies: 'both',
  },
]

export function OrderStatusPill({ code }: { code: string }) {
  const s = ORDER_STATES.find((x) => x.code === code)
  if (!s) return <Badge>Unknown</Badge>
  return <Badge tone={s.tone}>{s.label}</Badge>
}
