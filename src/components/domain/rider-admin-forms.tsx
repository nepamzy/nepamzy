'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Input } from '@/components/ui/fields'
import {
  decideRiderApplicationAction,
  opsReleaseAssignmentAction,
  resolveRiderIssueAction,
  setRiderStatusAction,
} from '@/server/modules/riders/admin-actions'

export function DecideRiderForm({ id }: { id: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ActionForm
        action={decideRiderApplicationAction}
        submitLabel="Approve"
        pendingLabel="Approving…"
      >
        <input type="hidden" name="applicationId" value={id} />
        <input type="hidden" name="decision" value="approve" />
      </ActionForm>
      <ActionForm
        action={decideRiderApplicationAction}
        submitLabel="Reject"
        pendingLabel="Rejecting…"
      >
        <input type="hidden" name="applicationId" value={id} />
        <input type="hidden" name="decision" value="reject" />
        <Input label="Reason for rejecting" name="reason" required minLength={5} />
      </ActionForm>
    </div>
  )
}

export function RiderStatusForm({ id, status }: { id: string; status: string }) {
  const to = status === 'suspended' ? 'approved' : 'suspended'
  return (
    <ActionForm
      action={setRiderStatusAction}
      submitLabel={to === 'suspended' ? 'Suspend rider' : 'Reinstate rider'}
      pendingLabel="Saving…"
    >
      <input type="hidden" name="riderId" value={id} />
      <input type="hidden" name="status" value={to} />
      <Input label="Reason (recorded in the audit trail)" name="reason" required minLength={5} />
    </ActionForm>
  )
}

export function ResolveIssueForm({ id }: { id: string }) {
  return (
    <ActionForm action={resolveRiderIssueAction} submitLabel="Mark resolved" pendingLabel="Saving…">
      <input type="hidden" name="issueId" value={id} />
      <Input label="What was done?" name="note" required minLength={3} />
    </ActionForm>
  )
}

export function ReleaseForm({ assignmentId }: { assignmentId: string }) {
  return (
    <ActionForm
      action={opsReleaseAssignmentAction}
      submitLabel="Return delivery to the pool"
      pendingLabel="Releasing…"
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Input label="Reason" name="reason" required minLength={5} />
    </ActionForm>
  )
}
