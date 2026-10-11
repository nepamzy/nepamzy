import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { getMyRider } from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Rider profile' }

export default async function RiderProfile() {
  const me = await getMyRider()
  if (!me)
    return (
      <EmptyState title="Your rider account is not available">Contact an administrator.</EmptyState>
    )
  return (
    <>
      <PageHeader title="Rider profile" subtitle={me.full_name} />
      <Card className="max-w-xl space-y-3">
        <p>
          Rider terms: <strong>{me.terms_version}</strong>{' '}
          <Badge tone={me.terms_acknowledged ? 'success' : 'warning'}>
            {me.terms_acknowledged ? 'Accepted' : 'Not yet accepted'}
          </Badge>
        </p>
        <details>
          <summary className="cursor-pointer font-semibold">Read the terms</summary>
          {me.terms_is_placeholder && (
            <p className="mt-2 font-medium text-warning-700">
              Development placeholder: not approved by AFIT or counsel.
            </p>
          )}
          <p className="mt-2 whitespace-pre-line text-sm">{me.terms_body}</p>
        </details>
      </Card>
    </>
  )
}
