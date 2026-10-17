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
  const privileged = who.roles.some(isPrivilegedRole)
  return (
    <>
      <PageHeader title="Security" subtitle="Your second sign-in step" />
      <div className="space-y-5">
        <Card>
          <h2 className="mb-3 text-lg font-bold">Your authenticators</h2>
          <FactorList factors={factors} canRemoveLast={!privileged} />
        </Card>
        <Card>
          <h2 className="text-lg font-bold">Add a backup authenticator</h2>
          <p className="mb-4 mt-1 text-muted">
            Use a different phone or app. If you lose your main phone, the backup lets you in. We
            cannot restore access if you lose every authenticator.
          </p>
          <EnrollFlow kind="backup" next="/account/security" />
        </Card>
      </div>
    </>
  )
}
