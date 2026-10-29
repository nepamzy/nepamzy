import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { safeNextPath } from '@/server/modules/identity-and-access/policy'

// Not linked from any page: reached by tapping the logo three times on the home page. Hiding the door is not the protection;
// the administrator area is protected on the server (role, second step, database checks) whoever finds this address.
export const metadata: Metadata = {
  title: 'Administrator sign-in',
  robots: { index: false, follow: false },
}

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const sp = await searchParams
  const next = safeNextPath(sp.next)
  const who = await loadPrincipal()
  if (who.authenticated && who.aal === 'aal2') redirect(next === '/' ? '/admin' : next)
  return (
    <Card>
      <h1 className="mb-1 text-2xl font-bold">Administrator sign-in</h1>
      <p className="mb-4 text-sm text-muted">
        For platform administrators. You will be asked for your authenticator code next.
      </p>
      <SignInForm next={next} staff />
    </Card>
  )
}
