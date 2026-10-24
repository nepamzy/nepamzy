import type { Metadata } from 'next'
import { RiderApplicationForm } from '@/components/domain/rider-controls'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Deliver on AFIT Market' }

export default async function RiderApply() {
  const sb = await createSupabaseServerClient()
  const [{ data: apps }, { data: profile }] = await Promise.all([
    sb
      .from('rider_applications')
      .select('id, status, decision_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    sb.from('rider_profiles').select('status').maybeSingle(),
  ])
  const pending = (apps ?? []).find((a) => a.status === 'pending')
  return (
    <>
      <PageHeader
        title="Deliver on AFIT Market"
        subtitle="Apply to become an approved campus delivery rider"
      />
      {profile ? (
        <Card>
          <p>
            You are already a rider.{' '}
            <a className="font-semibold text-brand-700 underline" href="/rider">
              Open the rider area
            </a>
            .
          </p>
        </Card>
      ) : pending ? (
        <Card className="space-y-1">
          <p className="font-semibold">Your application is waiting for review.</p>
          <p className="text-muted">
            You can deliver once an administrator approves it and you accept the rider terms.
          </p>
        </Card>
      ) : (
        <Card className="max-w-xl">
          <RiderApplicationForm />
        </Card>
      )}
      {(apps ?? [])
        .filter((a) => a.status === 'rejected')
        .slice(0, 1)
        .map((a) => (
          <p key={a.id} className="mt-4 text-sm">
            <Badge tone="danger">Not approved</Badge> {a.decision_reason}
          </p>
        ))}
    </>
  )
}
