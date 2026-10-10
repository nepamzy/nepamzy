import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Administration' }
export default function AdminHome() {
  return (
    <>
      <PageHeader title="Administration" subtitle="Protected area. Every action here is recorded." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><h2 className="font-bold">Applications</h2><p className="text-muted">Review vendors and riders (sample data).</p><Link className="mt-2 inline-block font-semibold text-brand-700 underline" href="/admin/applications">Open</Link></Card>
        <Card><h2 className="font-bold">Audit trail</h2><p className="text-muted">Read-only record of security events.</p><Link className="mt-2 inline-block font-semibold text-brand-700 underline" href="/admin/audit">Open</Link></Card>
        <Card><h2 className="font-bold">Roles</h2><p className="text-muted">Grant or revoke roles (administrators only).</p><Link className="mt-2 inline-block font-semibold text-brand-700 underline" href="/admin/roles">Open</Link></Card>
      </div>
    </>
  )
}
