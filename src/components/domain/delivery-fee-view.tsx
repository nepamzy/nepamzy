import { lagosDateTime } from '@/lib/time'
import QRCode from 'qrcode'
import { Badge, type Tone } from '@/components/ui/badge'
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
            {lagosDateTime(h.at)} · {h.actor_role} · {h.action.replaceAll('_', ' ')}
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
  const issued = r.status !== 'void'
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
  return (
    <section
      aria-labelledby={`receipt-${r.id}`}
      className="overflow-hidden rounded-[var(--radius-card)] border border-brand-700 bg-card shadow-[var(--shadow-card)]"
    >
      <div className="border-b-4 border-gold-400 bg-navy-900 px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gold-400">
              AFIT Market · Delivery fee receipt
            </p>
            <h3 id={`receipt-${r.id}`} className="mt-1 text-xl font-extrabold">
              Delivery fee receipt {r.number}
            </h3>
          </div>
          {r.status === 'void' ? (
            <Badge tone="danger">Void</Badge>
          ) : (
            <span className="rounded-full bg-success-50 px-3 py-1 text-sm font-bold text-success-700">
              {DFP_STATUS[p.status].label}
            </span>
          )}
        </div>
        <p className="mt-3 text-3xl font-extrabold tracking-tight">
          <Money kobo={p.amount_kobo} />{' '}
          <span className="text-sm font-semibold text-navy-text">({p.currency})</span>
        </p>
        <p className="text-sm text-navy-text">
          Paid directly to the rider by bank transfer for order {p.order_number}
        </p>
      </div>
      <div className="space-y-4 p-5">
        <dl>
          {row('Order', p.order_number)}
          {row('Customer', p.customer_name)}
          {row('Rider', p.rider_name)}
          {row('Method', 'Direct Bank Transfer')}
          {row(
            'Customer reported',
            p.customer_reported_at ? lagosDateTime(p.customer_reported_at) : '—',
          )}
          {row(
            r.basis === 'administrator_resolution' ? 'Administrator decision' : 'Rider confirmed',
            lagosDateTime(
              r.basis === 'administrator_resolution'
                ? (p.resolved_at ?? r.issued_at)
                : (p.rider_responded_at ?? r.issued_at),
            ),
          )}
          {row('Issued', lagosDateTime(r.issued_at))}
          {row('Status', issued ? DFP_STATUS[p.status].label : 'Void (kept for the record)')}
        </dl>
        <p className="rounded-[var(--radius-control)] bg-surface p-3 text-sm text-muted">
          {BANK_NOTE}
        </p>
        {svg && url && (
          <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
            <div
              role="img"
              aria-label="QR code that opens the public receipt check page"
              className="h-40 w-40 rounded-[var(--radius-control)] border border-line bg-white p-1"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="min-w-0 flex-1 text-sm">
              Anyone with this link can check that the receipt exists:{' '}
              <a className="break-all font-semibold text-brand-700 underline" href={url}>
                {url}
              </a>
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
