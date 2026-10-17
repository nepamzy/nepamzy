import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EnrollFlow } from '@/components/auth/mfa'
import { Card } from '@/components/ui/card'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { safeNextPath } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Set up your second step' }

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNextPath((await searchParams).next)
  const who = await loadPrincipal()
  if (who.aal === 'aal2') redirect(next)
  if (who.hasVerifiedFactor) redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`)
  return (
    <Card>
      <h1 className="text-2xl font-bold">Set up your second sign-in step</h1>
      <p className="mb-4 mt-1 text-muted">
        An authenticator app on your phone makes a new 6-digit code every 30 seconds. It protects
        your account even if someone learns your password.
      </p>
      <EnrollFlow kind="primary" next={next} />
    </Card>
  )
}
