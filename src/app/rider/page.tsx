import type { Metadata } from 'next'
import Link from 'next/link'
import { GoActiveForm, GoInactiveForm, TermsForm } from '@/components/domain/rider-controls'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { getMyRider } from '@/server/modules/riders/queries'

export const metadata: Metadata = { title: 'Rider home' }

export default async function RiderHome() {
  const me = await getMyRider()
  if (!me)
    return (
      <EmptyState title="Your rider account is not available">
        Contact an administrator if you think this is a mistake.
      </EmptyState>
    )
  return (
    <>
      <PageHeader title="Rider home" subtitle={me.full_name} />
      <Card className="max-w-xl space-y-4">
        <p className="flex items-center gap-2 text-lg font-semibold">
          Status:{' '}
          <Badge tone={me.active ? 'success' : 'neutral'}>
            {me.active ? 'Active' : 'Off duty'}
          </Badge>
        </p>
        <p>
          Location sharing is{' '}
          <strong>
            {me.active && me.active_deliveries > 0 ? 'ON while you carry a delivery' : 'OFF'}
          </strong>
          . This app never collects your location until you choose <strong>Go Active</strong>, and
          only shares it while you hold an accepted delivery.
        </p>
        {!me.terms_acknowledged ? (
          <TermsForm
            version={me.terms_version}
            title={me.terms_title}
            body={me.terms_body}
            placeholder={me.terms_is_placeholder}
          />
        ) : me.active ? (
          <>
            <p>
              You have <strong>{me.active_deliveries}</strong> of 5 possible active deliveries.{' '}
              <Link className="font-semibold text-brand-700 underline" href="/rider/jobs">
                See jobs
              </Link>
            </p>
            <GoInactiveForm />
          </>
        ) : (
          <GoActiveForm />
        )}
      </Card>
    </>
  )
}
