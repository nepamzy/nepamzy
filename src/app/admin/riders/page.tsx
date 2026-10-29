import type { Metadata } from 'next'
import { DecideRiderForm, RiderStatusForm } from '@/components/domain/rider-admin-forms'
import { Icon } from '@/components/ui/icons'
import { StatusBadge } from '@/components/ui/status-badge'
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
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Riders' }]}
        title="Riders"
        subtitle="Approve applications and suspend riders. Every decision is recorded."
      />
      <section aria-labelledby="pending" className="mb-8 space-y-3">
        <h2 id="pending" className="text-lg font-extrabold text-navy-900">
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
        <h2 id="all" className="text-lg font-extrabold text-navy-900">
          Riders
        </h2>
        {riders.length === 0 ? (
          <EmptyState title="No riders yet">Approved riders appear here.</EmptyState>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {riders.map((r) => (
              <li key={r.user_id}>
                <Card className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-gold-400">
                      <Icon name="bike" size={22} />
                    </span>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-navy-900">{r.full_name}</span>
                      <StatusBadge
                        status={r.status === 'approved' ? 'active' : 'suspended'}
                        label={r.status === 'approved' ? 'Approved' : 'Suspended'}
                      />
                    </p>
                  </div>
                  <RiderStatusForm id={r.user_id} status={r.status} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
