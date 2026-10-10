import type { Metadata } from 'next'
import { RoleForm } from '@/components/auth/role-form'
import { Card, PageHeader } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Roles' }
export default function RolesPage() {
  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="Grant or revoke a role. You cannot change your own roles."
      />
      <Card>
        <RoleForm />
      </Card>
    </>
  )
}
