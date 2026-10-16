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
      <Card className="mb-5 max-w-xl space-y-1">
        <p className="font-semibold">Rider earnings: Free of charge.</p>
        <p className="font-semibold">Delivery commission features: Coming Soon</p>
        <p className="text-sm text-muted">
          AFIT Market takes no commission from riders.{' '}
          <Link className="font-semibold text-brand-700 underline" href="/rider/payments">
            Bank details and delivery fee payments
          </Link>
        </p>
      </Card>
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
        {!me.terms_approved ? (
          <div role="status" className="space-y-2">
            <p className="rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700">
              The rider terms are still awaiting approval, so you cannot go active or accept
              deliveries yet. Please check back later.
            </p>
            <details>
              <summary className="cursor-pointer font-semibold">Read the draft terms</summary>
              <p className="mt-2 text-sm font-medium text-warning-700">
                Draft only: not approved by AFIT or counsel.
              </p>
              <p className="mt-2 whitespace-pre-line text-sm">{me.terms_body}</p>
            </details>
          </div>
        ) : !me.terms_acknowledged ? (
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
