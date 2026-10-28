import QRCode from 'qrcode'
import { Badge, type Tone } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { serverEnv } from '@/lib/env'
import type { DfpPayment } from '@/server/modules/delivery-fee/queries'

export const DFP_STATUS: Record<DfpPayment['status'], { label: string; tone: Tone; help: string }> =
  {
    awaiting_transfer: {
      label: 'Awaiting transfer',
      tone: 'warning',
      help: 'The customer has not yet said they made the transfer.',
    },
    customer_reported: {
      label: 'Awaiting Rider Confirmation',
      tone: 'info',
      help: 'Waiting for the rider to check their own bank account and confirm.',
    },
    rider_confirmed: {
      label: 'Confirmed',
      tone: 'success',
      help: 'The customer reported the transfer and the rider confirmed receiving it.',
    },
    rider_disputed: {
      label: 'Disputed',
      tone: 'danger',
      help: 'The rider says the money did not arrive. An administrator will review it.',
    },
    resolved_received: {
      label: 'Settled by administrator: received',
      tone: 'success',
      help: 'An administrator reviewed the dispute and recorded it as received.',
    },
    resolved_not_received: {
      label: 'Settled by administrator: not received',
      tone: 'danger',
      help: 'An administrator reviewed the dispute and recorded it as not received.',
    },
  }

/** Wording from the point of view of the person reading (the stored help text is neutral, third person). */
export function statusHelp(status: DfpPayment['status'], viewer: 'customer' | 'rider' | 'staff') {
  if (viewer === 'customer') {
    if (status === 'awaiting_transfer') return 'You have not yet said that you made the transfer.'
    if (status === 'customer_reported')
      return 'You said you sent it. Waiting for the rider to check their bank account and confirm.'
    if (status === 'rider_disputed')
      return 'The rider says the money did not arrive. An administrator will review it.'
  }
  if (viewer === 'rider') {
    if (status === 'awaiting_transfer')
      return 'The customer has not yet said they made the transfer.'
    if (status === 'customer_reported')
      return 'The customer says they sent it. Check your own bank account before answering.'
  }
  return DFP_STATUS[status].help
}

export const BANK_NOTE =
  'AFIT Market does not hold this money and cannot check your bank. The customer and the rider each state what they did; that is recorded, but it is not a bank statement or independent proof of payment.'

export function StatusBadge({ status }: { status: DfpPayment['status'] }) {
  const s = DFP_STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function History({ items }: { items: NonNullable<DfpPayment['history']> }) {
  if (!items.length) return null
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">History</summary>
      <ul className="mt-2 space-y-1">
        {items.map((h, i) => (
          <li key={i}>
            {new Date(h.at).toLocaleString('en-NG')} · {h.actor_role} ·{' '}
            {h.action.replaceAll('_', ' ')}
            {h.note ? ` · “${h.note}”` : ''}
          </li>
        ))}
      </ul>
    </details>
  )
}

async function qrSvg(url: string) {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 160, errorCorrectionLevel: 'M' })
}

/** The official digital receipt for one direct payment. Voided receipts stay visible and say so. */
export async function ReceiptCard({ p }: { p: DfpPayment }) {
  const r = p.receipt
  if (!r) return null
  const url = r.token ? new URL(`/receipts/${r.token}`, serverEnv().SITE_URL).toString() : null
  const svg = url ? await qrSvg(url) : null
  return (
    <Card className="space-y-2 border-brand-700" aria-labelledby={`receipt-${r.id}`}>
      <h3 id={`receipt-${r.id}`} className="text-lg font-bold">
        Delivery fee receipt {r.number} {r.status === 'void' && <Badge tone="danger">Void</Badge>}
      </h3>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="font-semibold">Order</dt>
        <dd>{p.order_number}</dd>
        <dt className="font-semibold">Customer</dt>
        <dd>{p.customer_name}</dd>
        <dt className="font-semibold">Rider</dt>
        <dd>{p.rider_name}</dd>
        <dt className="font-semibold">Delivery fee</dt>
        <dd>
          <Money kobo={p.amount_kobo} /> ({p.currency})
        </dd>
        <dt className="font-semibold">Method</dt>
        <dd>Direct Bank Transfer</dd>
        <dt className="font-semibold">Customer reported</dt>
        <dd>
          {p.customer_reported_at ? new Date(p.customer_reported_at).toLocaleString('en-NG') : '—'}
        </dd>
        <dt className="font-semibold">
          {r.basis === 'administrator_resolution' ? 'Administrator decision' : 'Rider confirmed'}
        </dt>
        <dd>
          {new Date(
            r.basis === 'administrator_resolution'
              ? (p.resolved_at ?? r.issued_at)
              : (p.rider_responded_at ?? r.issued_at),
          ).toLocaleString('en-NG')}
        </dd>
        <dt className="font-semibold">Issued</dt>
        <dd>{new Date(r.issued_at).toLocaleString('en-NG')}</dd>
        <dt className="font-semibold">Status</dt>
        <dd>{r.status === 'void' ? 'Void (kept for the record)' : DFP_STATUS[p.status].label}</dd>
      </dl>
      <p className="text-sm text-muted">{BANK_NOTE}</p>
      {svg && url && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="img"
            aria-label="QR code that opens the public receipt check page"
            className="h-40 w-40 bg-white"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-sm">
            Anyone with this link can check that the receipt exists:{' '}
            <a className="break-all font-semibold text-brand-700 underline" href={url}>
              {url}
            </a>
          </p>
        </div>
      )}
    </Card>
  )
}
