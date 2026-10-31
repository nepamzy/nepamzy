import { lagosDate } from '@/lib/time'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/fields'
import { Icon } from '@/components/ui/icons'
import { LinkTabs, SearchBar } from '@/components/ui/list-controls'
import { EmptyState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setVendorStatusAction } from '@/server/modules/vendors-and-catalogue/actions'

export const metadata: Metadata = { title: 'Vendors' }

const TABS = [
  ['all', 'All shops', null],
  ['approved', 'Approved', 'approved'],
  ['suspended', 'Suspended', 'suspended'],
] as const

export default async function VendorsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; q?: string; tab?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').replace(/[%_\\]/g, '').slice(0, 60)
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0]
  const sb = await createSupabaseServerClient()
  let query = sb
    .from('vendors')
    .select('id, name, slug, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (tab[2]) query = query.eq('status', tab[2])
  if (q) query = query.ilike('name', `%${q}%`)
  const { data } = await query
  const href = (k: string) =>
    `/admin/vendors?${new URLSearchParams({ ...(q ? { q } : {}), ...(k === 'all' ? {} : { tab: k }) })}`
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Vendors' }]}
        title="Vendors"
        subtitle="Suspending hides a vendor from customers and blocks its changes immediately."
        actions={
          <Link
            href="/admin/applications"
            className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold text-navy-900 hover:bg-brand-50"
          >
            Review applications
          </Link>
        }
      />
      {sp.saved && (
        <Alert tone="success" className="mb-4">
          Status changed and recorded.
        </Alert>
      )}
      {sp.error && (
        <Alert tone="danger" className="mb-4">
          {sp.error}
        </Alert>
      )}
      <LinkTabs
        label="Shop status"
        active={tab[0]}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: href(k) }))}
      />
      <SearchBar
        action="/admin/vendors"
        q={q}
        label="Search shops"
        placeholder="Shop name"
        hidden={{ tab: tab[0] === 'all' ? undefined : tab[0] }}
      />
      {(data ?? []).length === 0 ? (
        <EmptyState title="No shops match" icon="store">
          Approved shops appear here after an application is accepted.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {(data ?? []).map((v) => (
            <li
              key={v.id}
              className="space-y-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]"
              data-testid="vendor-row"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-navy-900 text-gold-400">
                  <Icon name="store" size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/vendors/${v.slug}`}
                      className="text-lg font-extrabold text-navy-900 hover:underline"
                    >
                      {v.name}
                    </Link>
                    <StatusBadge
                      status={v.status === 'approved' ? 'active' : 'suspended'}
                      label={v.status === 'approved' ? 'Approved' : 'Suspended'}
                    />
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {v.slug} · joined {lagosDate(v.created_at)}
                  </p>
                </div>
              </div>
              <form action={setVendorStatusAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="vendorId" value={v.id} />
                <input
                  type="hidden"
                  name="status"
                  value={v.status === 'approved' ? 'suspended' : 'approved'}
                />
                <div className="min-w-60 flex-1">
                  <Input
                    label="Reason (required)"
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                  />
                </div>
                <Button type="submit" variant={v.status === 'approved' ? 'danger' : 'primary'}>
                  {v.status === 'approved' ? 'Suspend' : 'Reinstate'}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
