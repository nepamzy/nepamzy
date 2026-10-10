import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { Table, Td } from '@/components/ui/table'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Audit trail' }

/** REAL data: read through RLS as the signed-in staff user (aal2 + role enforced by the database). */
export default async function AuditPage() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('audit_events').select('id, occurred_at, actor_id, action, entity_type, entity_id').order('id', { ascending: false }).limit(100)
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Latest 100 events. Records cannot be edited or deleted." />
      {error ? <EmptyState title="Could not load the audit trail">Please try again.</EmptyState> : (data ?? []).length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <Table caption="Audit events" head={['When', 'Who', 'Action', 'Subject']}>
          {(data ?? []).map((e) => (
            <tr key={e.id}>
              <Td>{new Date(e.occurred_at).toLocaleString('en-NG')}</Td>
              <Td><span className="font-mono text-sm">{e.actor_id ? e.actor_id.slice(0, 8) : 'system'}</span></Td>
              <Td>{e.action}</Td>
              <Td>{[e.entity_type, e.entity_id?.slice(0, 8)].filter(Boolean).join(' ')}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
