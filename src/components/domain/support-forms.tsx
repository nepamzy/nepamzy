'use client'
import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/fields'
import { Money } from '@/components/ui/money'
import {
  addStatementAction,
  caseCloseAction,
  caseDecideAction,
  caseStartReviewAction,
  confirmReturnReceivedAction,
  openCaseAction,
  opsExceptionAction,
  refundDecideAction,
  refundExecuteAction,
  refundReconcileAction,
  refundReviewAction,
  requestRefundCustomerAction,
  requestReturnAction,
  returnDecideAction,
} from '@/server/modules/support/actions'
import type { ItemBalance } from '@/server/modules/support/queries'

/** One idempotency key per form instance; it changes after a request has been created so the next one is a new request. */
function useKey(count: number) {
  const [rand] = useState(() => crypto.randomUUID())
  return `${rand}-${count}`
}

function ItemPicker({
  items,
  field,
}: {
  items: ItemBalance[]
  field: 'refund_left' | 'return_left'
}) {
  const rows = items.filter((i) => i[field] > 0)
  if (rows.length === 0)
    return <p className="text-sm text-muted">Nothing is left to choose on this order.</p>
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Choose the items</legend>
      {rows.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-3">
          <Checkbox label={`${i.name} · `} name={`item_${i.id}`} />
          <Money kobo={i.unit_price_kobo} />
          <label className="flex items-center gap-2 text-sm">
            Quantity
            <input
              type="number"
              name={`qty_${i.id}`}
              min={1}
              max={i[field]}
              defaultValue={1}
              className="touch-target w-20 rounded-[var(--radius-control)] border border-line-strong bg-card px-2 py-1.5"
              aria-label={`Quantity of ${i.name}`}
            />
            <span className="text-muted">(up to {i[field]})</span>
          </label>
        </div>
      ))}
    </fieldset>
  )
}

export function CustomerRefundForm({
  orderId,
  items,
  refundableKobo,
  existing,
}: {
  orderId: string
  items: ItemBalance[]
  refundableKobo: number
  existing: number
}) {
  const key = useKey(existing)
  const [scope, setScope] = useState<'full' | 'items'>('full')
  return (
    <ActionForm
      action={requestRefundCustomerAction}
      submitLabel="Send refund request"
      pendingLabel="Sending…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="scope" value={scope} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">What do you want refunded?</legend>
        <label className="touch-target flex items-center gap-3">
          <input
            type="radio"
            checked={scope === 'full'}
            onChange={() => setScope('full')}
            name="scope_ui"
          />
          <span>
            Everything still refundable (<Money kobo={refundableKobo} />)
          </span>
        </label>
        <label className="touch-target flex items-center gap-3">
          <input
            type="radio"
            checked={scope === 'items'}
            onChange={() => setScope('items')}
            name="scope_ui"
          />
          <span>Only some items</span>
        </label>
      </fieldset>
      {scope === 'items' && <ItemPicker items={items} field="refund_left" />}
      <Textarea label="What went wrong?" name="reason" required minLength={5} maxLength={500} />
      <p className="text-sm text-muted">
        This sends a request. It is not a refund until our team has reviewed and approved it, and
        you will see each step here.
      </p>
    </ActionForm>
  )
}

export function CustomerReturnForm({
  orderId,
  items,
  existing,
}: {
  orderId: string
  items: ItemBalance[]
  existing: number
}) {
  const key = useKey(existing)
  return (
    <ActionForm
      action={requestReturnAction}
      submitLabel="Send return request"
      pendingLabel="Sending…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="key" value={key} />
      <ItemPicker items={items} field="return_left" />
      <Textarea
        label="Why do you want to return it?"
        name="reason"
        required
        minLength={5}
        maxLength={500}
      />
      <p className="text-sm text-muted">
        A return is separate from a refund. Do not send anything back until support approves the
        return.
      </p>
    </ActionForm>
  )
}

export const CASE_TYPES: [string, string][] = [
  ['missing_item', 'An item is missing'],
  ['wrong_item', 'I got the wrong item'],
  ['damaged', 'An item is damaged'],
  ['not_received', 'I did not receive my order'],
  ['quality', 'Quality problem'],
  ['delivery_problem', 'Problem with the delivery'],
  ['other', 'Something else'],
]

export function OpenCaseForm({ orderId, existing }: { orderId: string; existing: number }) {
  const key = useKey(existing)
  return (
    <ActionForm action={openCaseAction} submitLabel="Send report" pendingLabel="Sending…">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="key" value={key} />
      <Select label="What is the problem?" name="type" required defaultValue="missing_item">
        {CASE_TYPES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Textarea
        label="Tell us what happened"
        name="description"
        required
        minLength={10}
        maxLength={1000}
      />
    </ActionForm>
  )
}

export function StatementForm({ caseId, staff }: { caseId: string; staff?: boolean }) {
  return (
    <ActionForm action={addStatementAction} submitLabel="Add statement" pendingLabel="Saving…">
      <input type="hidden" name="caseId" value={caseId} />
      <Textarea label="Your statement" name="body" required minLength={3} maxLength={1000} />
      {staff && <Checkbox label="Internal note (only staff can see it)" name="internal" />}
    </ActionForm>
  )
}

// ---- staff ----------------------------------------------------------------------------------
export function RefundStaffControls({
  refundId,
  status,
  ownRequest,
  canApprove,
  canExecute,
}: {
  refundId: string
  status: string
  ownRequest: boolean
  canApprove: boolean
  canExecute: boolean
}) {
  return (
    <div className="space-y-3">
      {ownRequest && (
        <p className="text-sm text-muted">You made this request, so you cannot decide or run it.</p>
      )}
      {status === 'requested' && !ownRequest && (
        <ActionForm action={refundReviewAction} submitLabel="Start review" pendingLabel="Saving…">
          <input type="hidden" name="refundId" value={refundId} />
        </ActionForm>
      )}
      {['requested', 'under_review'].includes(status) && !ownRequest && (
        <>
          <ActionForm action={refundDecideAction} submitLabel="Approve" pendingLabel="Saving…">
            <input type="hidden" name="refundId" value={refundId} />
            <input type="hidden" name="decision" value="approve" />
            <Input label="Reason for approving" name="reason" required minLength={5} />
            {!canApprove && (
              <p className="text-sm text-muted">
                Approving money movement is for finance (or support within the configured limit).
              </p>
            )}
          </ActionForm>
          <ActionForm action={refundDecideAction} submitLabel="Reject" pendingLabel="Saving…">
            <input type="hidden" name="refundId" value={refundId} />
            <input type="hidden" name="decision" value="reject" />
            <Input label="Reason for rejecting" name="reason" required minLength={5} />
          </ActionForm>
        </>
      )}
      {status === 'approved' && !ownRequest && canExecute && (
        <ActionForm
          action={refundExecuteAction}
          submitLabel="Execute with the FAKE provider"
          pendingLabel="Running…"
        >
          <input type="hidden" name="refundId" value={refundId} />
          <p className="rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 text-sm font-medium text-warning-700">
            FAKE PROVIDER: nothing is sent to Paystack and no money moves. Real refund execution is
            not built.
          </p>
          <Select label="Pretend the provider answers…" name="scenario" defaultValue="success">
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="timeout">no answer (needs reconciliation)</option>
          </Select>
        </ActionForm>
      )}
      {status === 'reconciliation_required' && canExecute && (
        <ActionForm
          action={refundReconcileAction}
          submitLabel="Record the real outcome"
          pendingLabel="Saving…"
        >
          <input type="hidden" name="refundId" value={refundId} />
          <Select label="What really happened?" name="resolution" defaultValue="failed">
            <option value="failed">It did not go through</option>
            <option value="succeeded">It went through</option>
          </Select>
          <Input label="Provider reference (needed if it went through)" name="ref" />
          <Input label="How did you check?" name="note" required minLength={5} />
        </ActionForm>
      )}
    </div>
  )
}

export function CaseStaffControls({
  caseId,
  status,
  items,
}: {
  caseId: string
  status: string
  items: ItemBalance[]
}) {
  return (
    <div className="space-y-4">
      {status === 'open' && (
        <ActionForm
          action={caseStartReviewAction}
          submitLabel="Start review"
          pendingLabel="Saving…"
        >
          <input type="hidden" name="caseId" value={caseId} />
        </ActionForm>
      )}
      {['open', 'under_review'].includes(status) && (
        <ActionForm action={caseDecideAction} submitLabel="Record decision" pendingLabel="Saving…">
          <input type="hidden" name="caseId" value={caseId} />
          <Select label="Decision" name="decision" defaultValue="no_action">
            <option value="no_action">No action</option>
            <option value="reject">Reject the claim</option>
            <option value="replacement">Replacement</option>
            <option value="partial_refund">Partial refund (choose items)</option>
            <option value="full_refund">Full refund request</option>
            <option value="return">Return (choose items)</option>
          </Select>
          <Textarea
            label="Reason (kept with the decision)"
            name="reason"
            required
            minLength={10}
            maxLength={1000}
          />
          <ItemPicker items={items} field="refund_left" />
          <p className="text-sm text-muted">
            A refund decision only creates a refund REQUEST. Finance approves and executes it
            separately. Location data is not used to decide a case.
          </p>
        </ActionForm>
      )}
      {status === 'decided' && (
        <ActionForm action={caseCloseAction} submitLabel="Close report" pendingLabel="Saving…">
          <input type="hidden" name="caseId" value={caseId} />
          <Input label="Closing note" name="note" />
        </ActionForm>
      )}
    </div>
  )
}

export function ReturnDecisionForm({ returnId }: { returnId: string }) {
  return (
    <div className="space-y-3">
      {(['approve', 'reject'] as const).map((d) => (
        <ActionForm
          key={d}
          action={returnDecideAction}
          submitLabel={d === 'approve' ? 'Approve return' : 'Reject return'}
          pendingLabel="Saving…"
        >
          <input type="hidden" name="returnId" value={returnId} />
          <input type="hidden" name="decision" value={d} />
          <Input
            label={`Reason for ${d === 'approve' ? 'approving' : 'rejecting'}`}
            name="reason"
            required
            minLength={5}
          />
        </ActionForm>
      ))}
    </div>
  )
}

export function ReturnReceivedForm({ returnId }: { returnId: string }) {
  return (
    <ActionForm
      action={confirmReturnReceivedAction}
      submitLabel="Confirm item received"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="returnId" value={returnId} />
      <Input
        label="Condition of the returned item"
        name="condition"
        required
        minLength={3}
        maxLength={300}
      />
    </ActionForm>
  )
}

export function OpsExceptionForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      action={opsExceptionAction}
      submitLabel="Release parcel and open a report"
      pendingLabel="Saving…"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Input label="What happened?" name="reason" required minLength={10} maxLength={500} />
      <p className="text-sm text-muted">
        This never marks the order delivered. The rider is released and the order goes to a report
        for a human decision.
      </p>
    </ActionForm>
  )
}
