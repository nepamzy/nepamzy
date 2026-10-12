'use client'
import { ActionForm } from '@/components/forms/action-form'
import { Checkbox, Select, Textarea } from '@/components/ui/fields'
import {
  createReviewAction,
  markNotificationsReadAction,
  moderateReportAction,
  reportReviewAction,
  setNotificationPreferenceAction,
  unhideReviewAction,
} from '@/server/modules/engagement/actions'

export function ReviewForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={createReviewAction} submitLabel="Publish review" pendingLabel="Saving…">
      <input type="hidden" name="orderId" value={orderId} />
      <Select label="Rating" name="rating" required defaultValue="">
        <option value="" disabled>
          Choose…
        </option>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {n} out of 5
          </option>
        ))}
      </Select>
      <Textarea
        label="Comment (optional)"
        name="comment"
        maxLength={500}
        hint="Do not include phone numbers, addresses or other personal details. Reviews cannot be edited."
      />
    </ActionForm>
  )
}

export function MarkReadButton({ id }: { id?: string }) {
  return (
    <ActionForm
      action={markNotificationsReadAction}
      submitLabel={id ? 'Mark as read' : 'Mark all as read'}
      pendingLabel="Saving…"
    >
      {id && <input type="hidden" name="id" value={id} />}
    </ActionForm>
  )
}

export function PreferenceForm({ emailEnabled }: { emailEnabled: boolean }) {
  return (
    <ActionForm action={setNotificationPreferenceAction} submitLabel="Save" pendingLabel="Saving…">
      <Checkbox
        label="Also copy my notifications to the local test sink"
        name="email_enabled"
        defaultChecked={emailEnabled}
      />
      <p className="text-sm text-muted">
        No real email, SMS or push message is sent by this system. This only writes a copy to a
        local test sink on the server, so the delivery pipeline can be rehearsed.
      </p>
    </ActionForm>
  )
}

export function ReportReviewForm({ reviewId }: { reviewId: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700 underline">
        Report this review
      </summary>
      <ActionForm
        action={reportReviewAction}
        submitLabel="Send report"
        pendingLabel="Sending…"
        className="mt-2"
      >
        <input type="hidden" name="reviewId" value={reviewId} />
        <Select label="Why?" name="reason" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          <option value="abusive">Abusive or hateful</option>
          <option value="spam">Spam</option>
          <option value="off_topic">Not about this shop</option>
          <option value="personal_info">Shows personal information</option>
          <option value="other">Something else</option>
        </Select>
        <Textarea label="Note (optional)" name="note" maxLength={300} />
      </ActionForm>
    </details>
  )
}

export function ModerateForm({ reportId, canJudge }: { reportId: string; canJudge: boolean }) {
  if (!canJudge) return null
  return (
    <ActionForm action={moderateReportAction} submitLabel="Record decision" pendingLabel="Saving…">
      <input type="hidden" name="reportId" value={reportId} />
      <Select label="Decision" name="decision" required defaultValue="">
        <option value="" disabled>
          Choose…
        </option>
        <option value="hide">Hide the review (it is kept, not deleted)</option>
        <option value="dismiss">Dismiss the report (review stays visible)</option>
      </Select>
      <Textarea
        label="Reason (at least 10 characters)"
        name="reason"
        required
        minLength={10}
        maxLength={500}
      />
    </ActionForm>
  )
}

export function UnhideForm({ reviewId }: { reviewId: string }) {
  return (
    <ActionForm action={unhideReviewAction} submitLabel="Restore review" pendingLabel="Saving…">
      <input type="hidden" name="reviewId" value={reviewId} />
      <Textarea
        label="Reason for restoring (at least 10 characters)"
        name="reason"
        required
        minLength={10}
        maxLength={500}
      />
    </ActionForm>
  )
}
