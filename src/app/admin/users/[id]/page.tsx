import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SuspendUserButton } from '@/components/domain/admin-controls'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { z } from 'zod'
import { userDetail } from '@/server/modules/admin/queries'

export const metadata: Metadata = { title: 'User' }

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id
  if (!z.uuid().safeParse(id).success) notFound()
  const u = await userDetail(id)
  if (!u) notFound()
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line py-2 last:border-b-0">
      <dt className="font-semibold text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
  return (
    <>
      <PageHeader
        title={u.display_name ?? u.email}
        subtitle={u.display_name ? u.email : undefined}
        breadcrumbs={[
          { label: 'Administration', href: '/admin' },
          { label: 'Users', href: '/admin/users' },
          { label: u.display_name ?? u.email },
        ]}
        actions={<SuspendUserButton userId={u.id} suspended={u.suspended} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-lg font-extrabold text-navy-900">Account</h2>
          <dl>
            {row(
              'Status',
              u.suspended ? (
                <Badge tone="danger">Suspended</Badge>
              ) : (
                <Badge tone="success">Active</Badge>
              ),
            )}
            {row('Email confirmed', u.email_confirmed ? 'Yes' : 'No')}
            {row('Two-step sign-in', u.has_authenticator ? 'On' : 'Off')}
            {row('Joined', new Date(u.created_at).toLocaleString('en-NG'))}
            {row(
              'Last sign-in',
              u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('en-NG') : 'Never',
            )}
          </dl>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-extrabold text-navy-900">Roles and activity</h2>
          <dl>
            {row(
              'Roles',
              <span className="flex flex-wrap justify-end gap-1">
                {u.roles.map((r) => (
                  <Badge key={r} tone="brand">
                    {r.replaceAll('_', ' ')}
                  </Badge>
                ))}
              </span>,
            )}
            {row('Orders as a customer', u.orders_as_customer)}
            {row('Shop', u.vendor ? `${u.vendor.name} (${u.vendor.status})` : 'None')}
            {row('Rider status', u.rider_status ?? 'Not a rider')}
          </dl>
          <p className="mt-3 text-sm text-muted">
            Change roles on the{' '}
            <Link href="/admin/roles" className="font-bold text-brand-700 underline">
              Roles page
            </Link>
            . Opening this page is recorded in the audit log.
          </p>
        </Card>
      </div>
    </>
  )
}
