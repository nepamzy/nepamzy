import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/fields'
import { EmptyState } from '@/components/ui/states'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { decideApplicationAction } from '@/server/modules/vendors-and-catalogue/actions'

export const metadata: Metadata = { title: 'Vendor applications' }

export default async function Applications({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams
  const sb = await createSupabaseServerClient()
  const { data } = await sb.from('vendor_applications').select('id, business_name, contact_phone, description, pickup_location_text, status, decision_reason, created_at, categories:category_id(name)').order('created_at', { ascending: false }).limit(50)
  const rows = (data ?? []) as unknown as { id: string; business_name: string; contact_phone: string; description: string; pickup_location_text: string; status: string; decision_reason: string | null; created_at: string; categories: { name: string } | null }[]
  const pending = rows.filter((r) => r.status === 'pending'); const decided = rows.filter((r) => r.status !== 'pending')
  return (
    <>
      <PageHeader title="Vendor applications" subtitle="Approving creates the vendor and gives the applicant the vendor role." />
      {sp.saved && <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700">Decision saved and recorded.</p>}
      {sp.error && <p role="alert" className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700">{sp.error}</p>}
      <h2 className="mb-2 text-lg font-bold">Waiting for review ({pending.length})</h2>
      {pending.length === 0 ? <EmptyState title="Nothing waiting" /> : (
        <ul className="space-y-3">{pending.map((a) => (
          <li key={a.id}><Card className="space-y-3" data-testid="pending-application">
            <div><p className="text-lg font-bold">{a.business_name}</p><p className="text-sm text-muted">{a.categories?.name} · {a.contact_phone} · {new Date(a.created_at).toLocaleDateString('en-NG')}</p></div>
            <p>{a.description}</p><p className="text-sm"><strong>Pickup:</strong> {a.pickup_location_text}</p>
            <form action={decideApplicationAction} className="space-y-3">
              <input type="hidden" name="applicationId" value={a.id} />
              <Input label="Reason (required to reject)" name="reason" maxLength={500} />
              <div className="flex flex-wrap gap-2"><Button type="submit" name="decision" value="approve">Approve</Button><Button type="submit" name="decision" value="reject" variant="danger">Reject</Button></div>
            </form>
          </Card></li>))}</ul>
      )}
      {decided.length > 0 && <section className="mt-8" aria-labelledby="done"><h2 id="done" className="mb-2 text-lg font-bold">Decided</h2>
        <ul className="space-y-2">{decided.map((a) => <li key={a.id}><Card className="p-3 sm:p-3"><p className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.business_name}</span><Badge tone={a.status === 'approved' ? 'success' : 'danger'}>{a.status === 'approved' ? 'Approved' : 'Rejected'}</Badge></p>{a.decision_reason && <p className="text-sm text-muted">{a.decision_reason}</p>}</Card></li>)}</ul></section>}
    </>
  )
}
