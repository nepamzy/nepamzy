import { lagosDate } from '@/lib/time'
import type { Metadata } from 'next'
import { DataRequestForm } from '@/components/domain/engagement-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { myDataRequests } from '@/server/modules/engagement/queries'

export const metadata: Metadata = { title: 'Your data' }

export default async function DataRequests() {
  const rows = await myDataRequests()
  return (
    <>
      <PageHeader
        title="Your data and your account"
        subtitle="Ask for a copy of your data, a correction, deletion, or to close your account."
      />
      <Card className="mb-6 space-y-3">
        <p className="text-sm">
          A person reviews every request; nothing happens automatically. Records the law or our
          dispute process requires us to keep, such as payments and refunds, may have to be kept. We
          will tell you what was done and what was kept.
        </p>
        <DataRequestForm />
      </Card>
      <h2 className="mb-2 text-lg font-bold">Your requests</h2>
      {rows.length === 0 ? (
        <p className="text-muted">You have not made any requests.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.kind}</span>
                  <Badge
                    tone={
                      r.status === 'completed'
                        ? 'success'
                        : r.status === 'declined'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {r.status.replaceAll('_', ' ')}
                  </Badge>
                  <span className="text-sm text-muted">{lagosDate(r.created_at)}</span>
                </p>
                {r.response_note && <p className="text-sm">Reply: {r.response_note}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
