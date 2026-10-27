import type { Metadata } from 'next'
import { EnrollFlow, FactorList, type FactorRow } from '@/components/auth/mfa'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { isPrivilegedRole } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Security' }

export default async function SecurityPage() {
  const who = await loadPrincipal()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.mfa.listFactors()
  const factors: FactorRow[] = (data?.totp ?? []).map((f) => ({
    id: f.id,
    name: f.friendly_name ?? 'Authenticator',
    status: f.status,
    createdAt: f.created_at,
  }))
  const verified = factors.filter((f) => f.status === 'verified').length
  const privileged = who.roles.some(isPrivilegedRole)
  return (
    <>
      <PageHeader title="Security" subtitle="Two-step sign-in with an authenticator app" />
      <div className="space-y-5">
        {verified === 0 ? (
          <Card>
            <h2 className="text-lg font-bold">Turn on two-step sign-in (optional)</h2>
            <p className="mb-4 mt-1 text-muted">
              Add an extra lock to your account: after your password, you type a 6-digit code from
              an authenticator app on your phone. You do not need this to use AFIT Market. If you
              turn it on and lose your phone, we cannot restore access, so also add a backup.
            </p>
            <EnrollFlow kind="primary" next="/account/security" />
          </Card>
        ) : (
          <>
            <Card>
              <h2 className="mb-3 text-lg font-bold">Your authenticators</h2>
              <FactorList factors={factors} canRemoveLast={!privileged} />
              {!privileged && (
                <p className="mt-2 text-sm text-muted">
                  Removing your last authenticator turns two-step sign-in off.
                </p>
              )}
            </Card>
            <Card>
              <h2 className="text-lg font-bold">Add a backup authenticator</h2>
              <p className="mb-4 mt-1 text-muted">
                Use a different phone or app. If you lose your main phone, the backup lets you in.
                We cannot restore access if you lose every authenticator.
              </p>
              <EnrollFlow kind="backup" next="/account/security" />
            </Card>
          </>
        )}
      </div>
    </>
  )
}
