import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ChallengeForm, type FactorRow } from '@/components/auth/mfa'
import { Card } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { safeNextPath } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Enter your code' }

export default async function ChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNextPath((await searchParams).next)
  const who = await loadPrincipal()
  if (who.aal === 'aal2') redirect(next)
  if (!who.hasVerifiedFactor) redirect(`/mfa/enroll?next=${encodeURIComponent(next)}`)
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.mfa.listFactors()
  const factors: FactorRow[] = (data?.totp ?? []).map((f) => ({
    id: f.id,
    name: f.friendly_name ?? 'Authenticator',
    status: f.status,
    createdAt: f.created_at,
  }))
  return (
    <Card>
      <h1 className="text-2xl font-bold">Enter your code</h1>
      <p className="mb-4 mt-1 text-muted">
        Open your authenticator app and type the 6-digit code for AFIT Market.
      </p>
      <ChallengeForm factors={factors} next={next} />
      <p className="mt-4 text-sm text-muted">
        Lost your phone? Use your backup authenticator if you added one. Otherwise contact support;
        we cannot bypass this step for you.
      </p>
    </Card>
  )
}
