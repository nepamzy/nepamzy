import type { Metadata } from 'next'
import { ProfileForm } from '@/components/domain/customer-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { myProfile } from '@/server/modules/customer/queries'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const p = await myProfile()
  return (
    <>
      <PageHeader
        title="Profile"
        breadcrumbs={[{ label: 'My account', href: '/account' }, { label: 'Profile' }]}
      />
      <Card className="max-w-lg space-y-4">
        <p>
          <span className="font-bold">Email:</span> {p.email}
        </p>
        <p className="text-sm text-muted">
          Your email is your sign-in. It cannot be changed here yet.
          {p.createdAt ? ` Member since ${new Date(p.createdAt).toLocaleDateString('en-NG')}.` : ''}
        </p>
        <ProfileForm displayName={p.displayName ?? ''} />
      </Card>
    </>
  )
}
