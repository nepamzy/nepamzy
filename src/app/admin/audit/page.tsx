import { lagosDateTime } from '@/lib/time'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { SearchBar } from '@/components/ui/list-controls'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Audit log' }

const PAGE = 30

/** REAL data: read through RLS as the signed-in staff user (aal2 + role enforced by the database). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40)
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('audit_events')
    .select('id, occurred_at, actor_id, action, entity_type, entity_id, details')
    .order('id', { ascending: false })
  if (q) query = query.ilike('action', `%${q}%`)
  const { data, error } = await query.range((page - 1) * PAGE, (page - 1) * PAGE + PAGE)
  const rows = (data ?? []).slice(0, PAGE)
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Audit log' }]}
        title="Audit log"
        subtitle="A record of important actions. Records cannot be edited or deleted."
      />
      <SearchBar
        action="/admin/audit"
        q={q}
        label="Filter by action"
        placeholder="For example refund, mode_switched, suspended"
      />
      {error ? (
        <EmptyState title="Could not load the audit log" icon="alert">
          Please try again.
        </EmptyState>
      ) : (
        <DataTable
          caption="Audit events"
          rows={rows}
          rowKey={(e) => String(e.id)}
          empty={
            <EmptyState title="No events match" icon="clipboard">
              Try a different filter.
            </EmptyState>
          }
          columns={[
            { header: 'When', cell: (e) => lagosDateTime(e.occurred_at) },
            {
              header: 'Who',
              cell: (e) => (
                <span className="font-mono text-sm">
                  {e.actor_id ? e.actor_id.slice(0, 8) : 'system'}
                </span>
              ),
            },
            { header: 'Action', cell: (e) => <span className="font-semibold">{e.action}</span> },
            {
              header: 'Subject',
              cell: (e) => [e.entity_type, e.entity_id?.slice(0, 8)].filter(Boolean).join(' '),
            },
            {
              header: 'Reason',
              cell: (e) => {
                const r = (e.details as { reason?: unknown } | null)?.reason
                return typeof r === 'string' ? (
                  r.slice(0, 120)
                ) : (
                  <span className="text-muted">None</span>
                )
              },
            },
          ]}
        />
      )}
      <Pager
        basePath="/admin/audit"
        page={page}
        hasMore={(data ?? []).length > PAGE}
        params={{ q: q || undefined }}
      />
    </>
  )
}
