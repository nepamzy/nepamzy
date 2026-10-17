import type { Metadata } from 'next'
import { DecideRiderForm, RiderStatusForm } from '@/components/domain/rider-admin-forms'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { listRiderApplications, listRiderProfiles } from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Riders' }

export default async function Riders() {
  const [apps, riders] = await Promise.all([listRiderApplications(), listRiderProfiles()])
  const pending = apps.filter((a) => a.status === 'pending')
  return (
    <>
      <PageHeader
        title="Riders"
        subtitle="Approve applications and suspend riders. Every decision is recorded."
      />
      <section aria-labelledby="pending" className="mb-8 space-y-3">
        <h2 id="pending" className="text-lg font-bold">
          Waiting for review
        </h2>
        {pending.length === 0 ? (
          <EmptyState title="No applications waiting">
            New rider applications appear here.
          </EmptyState>
        ) : (
          pending.map((a) => (
            <Card key={a.id} className="space-y-3">
              <p className="font-bold">{a.full_name}</p>
              <p className="text-sm">
                Phone {a.contact_phone}
                {a.vehicle_note ? ` · ${a.vehicle_note}` : ''}
              </p>
              <DecideRiderForm id={a.id} />
            </Card>
          ))
        )}
      </section>
      <section aria-labelledby="all" className="space-y-3">
        <h2 id="all" className="text-lg font-bold">
          Riders
        </h2>
        {riders.length === 0 ? (
          <EmptyState title="No riders yet">Approved riders appear here.</EmptyState>
        ) : (
          riders.map((r) => (
            <Card key={r.user_id} className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.full_name}</span>
                <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>
                  {r.status === 'approved' ? 'Approved' : 'Suspended'}
                </Badge>
              </p>
              <RiderStatusForm id={r.user_id} status={r.status} />
            </Card>
          ))
        )}
      </section>
    </>
  )
}
