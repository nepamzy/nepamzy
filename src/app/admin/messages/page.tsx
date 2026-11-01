import { lagosDateTime } from '@/lib/time'
import type { Metadata } from 'next'
import { ContactStatusButtons } from '@/components/domain/admin-controls'
import { PageHeader } from '@/components/ui/card'
import { LinkTabs } from '@/components/ui/list-controls'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { ADMIN_PAGE_SIZE, listContactMessages } from '@/server/modules/admin/queries'

export const metadata: Metadata = { title: 'Messages' }

const TABS = [
  ['new', 'New'],
  ['read', 'Read'],
  ['closed', 'Closed'],
  ['all', 'All'],
] as const

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const sp = await searchParams
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'new'
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const data = await listContactMessages(tab === 'all' ? null : tab, page)
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Messages from the public contact form. Reply by email, then close the message."
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Messages' }]}
      />
      <LinkTabs
        label="Message status"
        active={tab}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `/admin/messages?tab=${k}` }))}
      />
      {data === null ? (
        <EmptyState title="We could not load messages" icon="alert">
          Please try again.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState title="No messages here" icon="mail">
          New messages from the contact form appear here.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.rows.map((m) => (
            <li
              key={m.id}
              className="rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-extrabold text-navy-900">{m.subject}</p>
                  <p className="text-sm text-muted">
                    {m.name} ·{' '}
                    <a className="text-brand-700 underline" href={`mailto:${m.email}`}>
                      {m.email}
                    </a>{' '}
                    · {lagosDateTime(m.created_at)}
                  </p>
                </div>
                <StatusBadge
                  status={
                    m.status === 'new' ? 'pending' : m.status === 'read' ? 'in_review' : 'closed'
                  }
                  label={m.status === 'new' ? 'New' : m.status === 'read' ? 'Read' : 'Closed'}
                />
              </div>
              <p className="mt-2 whitespace-pre-wrap">{m.message}</p>
              <div className="mt-3">
                <ContactStatusButtons id={m.id} status={m.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager
        basePath="/admin/messages"
        page={page}
        hasMore={data ? page * ADMIN_PAGE_SIZE < data.total : false}
        params={{ tab: tab === 'new' ? undefined : tab }}
      />
    </>
  )
}
