import { lagosDateTime } from '@/lib/time'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CaseStaffControls, StatementForm } from '@/components/domain/support-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { staffCaseBundle } from '@/server/modules/support/queries'
import type { ItemBalance } from '@/server/modules/support/queries'

export const metadata: Metadata = { title: 'Report (support)' }

type Bundle = {
  case: {
    id: string
    case_no: string
    type: string
    status: string
    description: string
    decision: string | null
    decision_reason: string | null
  }
  order: {
    number: string
    status: string
    vendor: string
    total_kobo: number
    deliver_to: string | null
  }
  items: { id: string; name: string; quantity: number; unit_price_kobo: number }[]
  payment: { received_kobo: number; refunded_kobo: number; refundable_kobo: number }
  order_timeline: { to: string; at: string; reason: string | null }[]
  assignments: {
    no: number
    status: string
    rider: string | null
    arrival_detected_at: string | null
    completed_at: string | null
    release_reason: string | null
  }[]
  delivery_proof: {
    kind: string
    method: string
    recipient: string
    completed_at: string
    arrival_detected_at: string | null
  } | null
  code_outcomes: {
    pickup_code_failed_attempts: number | null
    proof_sessions: { failed_attempts: number; used: boolean; expired: boolean }[]
  }
  rider_issues: { reason: string; note: string | null; status: string }[]
  statements: { party: string; visibility: string; body: string; at: string }[]
  refunds: { id: string; amount_kobo: number; status: string; provider_mode: string }[]
  note: string
}

export default async function AdminCase({ params }: { params: Promise<{ id: string }> }) {
  const b = (await staffCaseBundle((await params).id)) as Bundle | null
  if (!b) notFound()
  const items: ItemBalance[] = b.items.map((i) => ({
    id: i.id,
    name: i.name,
    bought: i.quantity,
    unit_price_kobo: i.unit_price_kobo,
    refund_left: i.quantity,
    return_left: i.quantity,
  }))
  return (
    <>
      <p className="mb-2">
        <Link href="/admin/cases" className="font-semibold text-brand-700 underline">
          ← Reports
        </Link>
      </p>
      <PageHeader
        title={b.case.case_no}
        subtitle={`${b.order.number} · ${b.case.type.replaceAll('_', ' ')}`}
        actions={<Badge tone="info">{b.case.status.replaceAll('_', ' ')}</Badge>}
      />
      <p className="mb-4 rounded-[var(--radius-control)] bg-info-50 px-3 py-2 text-sm text-info-700">
        {b.note}
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">What was reported</h2>
          <p>{b.case.description}</p>
          {b.case.decision && (
            <p>
              <strong>Decision:</strong> {b.case.decision.replaceAll('_', ' ')}:{' '}
              {b.case.decision_reason}
            </p>
          )}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">Order and money</h2>
          <p>
            {b.order.vendor} · status <strong>{b.order.status}</strong> · total{' '}
            <Money kobo={b.order.total_kobo} />
          </p>
          <ul className="text-sm">
            {b.items.map((i) => (
              <li key={i.id}>
                {i.quantity} × {i.name} (<Money kobo={i.unit_price_kobo} />)
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Received <Money kobo={b.payment.received_kobo} /> · refunded{' '}
            <Money kobo={b.payment.refunded_kobo} /> · still refundable{' '}
            <Money kobo={b.payment.refundable_kobo} />
          </p>
          {b.refunds.length > 0 && (
            <p className="text-sm">
              Refunds:{' '}
              {b.refunds
                .map((r) => `${r.status}${r.provider_mode === 'fake' ? ' (fake)' : ''}`)
                .join(', ')}{' '}
              (manage in Refunds)
            </p>
          )}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">Delivery evidence (neutral)</h2>
          {b.assignments.length === 0 ? (
            <p className="text-sm">No rider was assigned.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {b.assignments.map((a) => (
                <li key={a.no}>
                  Attempt {a.no}: {a.rider ?? 'rider'} · {a.status}
                  {a.arrival_detected_at
                    ? ` · arrival detected ${lagosDateTime(a.arrival_detected_at)}`
                    : ''}
                  {a.release_reason ? ` · released: ${a.release_reason}` : ''}
                </li>
              ))}
            </ul>
          )}
          {b.delivery_proof ? (
            <p className="text-sm">
              Proof on file: {b.delivery_proof.kind}, {b.delivery_proof.method} signature by{' '}
              {b.delivery_proof.recipient} at {lagosDateTime(b.delivery_proof.completed_at)}. The
              signature image is only available through the audited proof tool.
            </p>
          ) : (
            <p className="text-sm">No handover proof on file.</p>
          )}
          {b.code_outcomes.proof_sessions.length > 0 && (
            <p className="text-sm">
              Confirmation sessions:{' '}
              {b.code_outcomes.proof_sessions
                .map(
                  (s) =>
                    `${s.used ? 'used' : s.expired ? 'expired' : 'open'} (${s.failed_attempts} wrong tries)`,
                )
                .join('; ')}
            </p>
          )}
          {b.rider_issues.length > 0 && (
            <p className="text-sm">
              Rider reports:{' '}
              {b.rider_issues
                .map((i) => `${i.reason.replaceAll('_', ' ')}${i.note ? ` (${i.note})` : ''}`)
                .join('; ')}
            </p>
          )}
        </Card>
        <Card className="space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">Order timeline</h2>
          <ul className="text-sm">
            {b.order_timeline.map((t, i) => (
              <li key={i}>
                {lagosDateTime(t.at)} · {t.to}
                {t.reason ? ` (${t.reason})` : ''}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="text-lg font-extrabold text-navy-900">Statements</h2>
          {b.statements.length === 0 ? (
            <p className="text-muted">No statements yet.</p>
          ) : (
            <ul className="space-y-2">
              {b.statements.map((s, i) => (
                <li key={i} className="rounded-[var(--radius-control)] border border-line p-3">
                  <p className="text-sm font-semibold">
                    {s.party}
                    {s.visibility === 'internal' ? ' (internal)' : ''}
                  </p>
                  <p>{s.body}</p>
                </li>
              ))}
            </ul>
          )}
          {b.case.status !== 'closed' && <StatementForm caseId={b.case.id} staff />}
        </Card>
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="text-lg font-extrabold text-navy-900">Decision</h2>
          <CaseStaffControls caseId={b.case.id} status={b.case.status} items={items} />
        </Card>
      </div>
    </>
  )
}
