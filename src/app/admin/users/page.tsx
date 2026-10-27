import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { LinkTabs, SearchBar } from '@/components/ui/list-controls'
import { Pager } from '@/components/ui/pager'
import { EmptyState } from '@/components/ui/states'
import { ADMIN_PAGE_SIZE, listUsers } from '@/server/modules/admin/queries'

export const metadata: Metadata = { title: 'Users' }

const TABS = [
  ['all', 'All users', null],
  ['customer', 'Customers', 'customer'],
  ['vendor', 'Vendors', 'vendor_owner'],
  ['rider', 'Riders', 'rider'],
  ['admin', 'Staff', 'platform_admin'],
] as const
const ROLE_LABEL: Record<string, string> = {
  customer: 'Customer',
  vendor_owner: 'Vendor owner',
  vendor_staff: 'Vendor staff',
  rider: 'Rider',
  support_agent: 'Support',
  finance_admin: 'Finance',
  platform_admin: 'Administrator',
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 80)
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0]
  const n = Number(sp.page)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  const data = await listUsers(q, tab[2], page)
  const href = (k: string) =>
    `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(k === 'all' ? {} : { tab: k }) })}`
  return (
    <>
      <PageHeader
        title="Users"
        subtitle="View and manage everyone on the platform"
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Users' }]}
        actions={
          <Link
            href="/admin/roles"
            className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-card px-4 font-bold text-navy-900 hover:bg-brand-50"
          >
            Grant or revoke roles
          </Link>
        }
      />
      <LinkTabs
        label="User type"
        active={tab[0]}
        tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: href(k) }))}
      />
      <SearchBar
        action="/admin/users"
        q={q}
        label="Search by name or email"
        placeholder="Name or email"
        hidden={{ tab: tab[0] === 'all' ? undefined : tab[0] }}
      />
      {data === null ? (
        <EmptyState title="We could not load users" icon="alert">
          Please try again.
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {data.total} {data.total === 1 ? 'user' : 'users'}
          </p>
          <DataTable
            caption="Users"
            rows={data.rows}
            rowKey={(u) => u.id}
            empty={
              <EmptyState title="No users match" icon="users">
                Try a different search or tab.
              </EmptyState>
            }
            columns={[
              {
                header: 'Name',
                cell: (u) => (
                  <span className="font-bold text-navy-900">{u.display_name ?? '(no name)'}</span>
                ),
              },
              { header: 'Email', cell: (u) => u.email },
              {
                header: 'Roles',
                cell: (u) => (
                  <span className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r} tone="brand">
                        {ROLE_LABEL[r] ?? r}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              {
                header: 'Status',
                cell: (u) =>
                  u.suspended ? (
                    <Badge tone="danger">Suspended</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  ),
              },
              { header: 'Joined', cell: (u) => new Date(u.created_at).toLocaleDateString('en-NG') },
              {
                header: 'Actions',
                cell: (u) => (
                  <Link
                    className="font-bold text-brand-700 hover:underline"
                    href={`/admin/users/${u.id}`}
                  >
                    View
                  </Link>
                ),
              },
            ]}
          />
          <Pager
            basePath="/admin/users"
            page={page}
            hasMore={page * ADMIN_PAGE_SIZE < data.total}
            params={{ q: q || undefined, tab: tab[0] === 'all' ? undefined : tab[0] }}
          />
        </>
      )}
    </>
  )
}
