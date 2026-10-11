import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/fields'
import { EmptyState } from '@/components/ui/states'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setVendorStatusAction } from '@/server/modules/vendors-and-catalogue/actions'

export const metadata: Metadata = { title: 'Vendors' }

export default async function VendorsAdmin({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams
  const sb = await createSupabaseServerClient()
  const { data } = await sb.from('vendors').select('id, name, slug, status, created_at').order('created_at', { ascending: false }).limit(100)
  return (
    <>
      <PageHeader title="Vendors" subtitle="Suspending hides a vendor from customers and blocks its changes immediately." />
      {sp.saved && <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700">Status changed and recorded.</p>}
      {sp.error && <p role="alert" className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700">{sp.error}</p>}
      {(data ?? []).length === 0 ? <EmptyState title="No vendors yet" /> : (
        <ul className="space-y-3">{(data ?? []).map((v) => (
          <li key={v.id}><Card className="space-y-3" data-testid="vendor-row">
            <p className="flex flex-wrap items-center gap-2"><span className="text-lg font-bold">{v.name}</span><span className="font-mono text-xs text-muted">{v.slug}</span><Badge tone={v.status === 'approved' ? 'success' : 'danger'}>{v.status === 'approved' ? 'Approved' : 'Suspended'}</Badge></p>
            <form action={setVendorStatusAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="vendorId" value={v.id} /><input type="hidden" name="status" value={v.status === 'approved' ? 'suspended' : 'approved'} />
              <div className="min-w-60 flex-1"><Input label="Reason (required)" name="reason" required minLength={5} maxLength={500} /></div>
              <Button type="submit" variant={v.status === 'approved' ? 'danger' : 'primary'}>{v.status === 'approved' ? 'Suspend' : 'Reinstate'}</Button>
            </form>
          </Card></li>))}</ul>
      )}
    </>
  )
}
