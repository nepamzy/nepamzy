import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductVisibilityButton } from '@/components/domain/admin-controls'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { LinkTabs, SearchBar } from '@/components/ui/list-controls'
import { Money } from '@/components/ui/money'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { StatusBadge } from '@/components/ui/status-badge'
import { ADMIN_PAGE_SIZE, listProducts } from '@/server/modules/admin/queries'

export const metadata: Metadata = { title: 'Catalogue' }

const TABS = [
  ['all', 'All items', null],
  ['active', 'Visible', 'active'],
  ['hidden', 'Hidden by admin', 'hidden'],
  ['archived', 'Archived by shops', 'archived'],
] as const

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 60)
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0]
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const data = await listProducts(q, tab[2], page)
  const href = (k: string) =>
    `/admin/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(k === 'all' ? {} : { tab: k }) })}`
  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle="Review items from every shop. Hiding an item removes it from the marketplace until you show it again."
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Catalogue' }]}
        actions={
          <Link
            href="/admin/categories"
            className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold text-navy-900 hover:bg-brand-50"
          >
            Manage categories
          </Link>
        }
      />
      <LinkTabs
        label="Item group"
        active={tab[0]}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: href(k) }))}
      />
      <SearchBar
        action="/admin/products"
        q={q}
        label="Search items or shops"
        placeholder="Item or shop name"
        hidden={{ tab: tab[0] === 'all' ? undefined : tab[0] }}
      />
      {data === null ? (
        <EmptyState title="We could not load items" icon="alert">
          Please try again.
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">{data.total} items</p>
          <DataTable
            caption="Catalogue items"
            rows={data.rows}
            rowKey={(p) => p.id}
            empty={
              <EmptyState title="No items match" icon="package">
                Try a different search or tab.
              </EmptyState>
            }
            columns={[
              {
                header: 'Item',
                cell: (p) => <span className="font-bold text-navy-900">{p.name}</span>,
              },
              {
                header: 'Shop',
                cell: (p) => (
                  <Link
                    className="text-brand-700 hover:underline"
                    href={`/vendors/${p.vendor_slug}`}
                  >
                    {p.vendor_name}
                  </Link>
                ),
              },
              { header: 'Price', align: 'right', cell: (p) => <Money kobo={p.price_kobo} /> },
              {
                header: 'Stock',
                cell: (p) => (p.stock_quantity === null ? 'Unlimited' : String(p.stock_quantity)),
              },
              {
                header: 'Status',
                cell: (p) => (
                  <StatusBadge
                    status={
                      p.status === 'active' ? (p.is_available ? 'active' : 'on_hold') : p.status
                    }
                    label={
                      p.status === 'active'
                        ? p.is_available
                          ? 'Visible'
                          : 'Visible, unavailable'
                        : p.status === 'hidden'
                          ? 'Hidden by admin'
                          : 'Archived'
                    }
                  />
                ),
              },
              {
                header: 'Actions',
                cell: (p) => <ProductVisibilityButton productId={p.id} status={p.status} />,
              },
            ]}
          />
          <Pager
            basePath="/admin/products"
            page={page}
            hasMore={page * ADMIN_PAGE_SIZE < data.total}
            params={{ q: q || undefined, tab: tab[0] === 'all' ? undefined : tab[0] }}
          />
        </>
      )}
    </>
  )
}
