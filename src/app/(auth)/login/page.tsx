import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { safeNextPath } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmed?: string; error?: string; reset?: string }>
}) {
  const sp = await searchParams
  const next = safeNextPath(sp.next)
  const who = await loadPrincipal()
  if (who.authenticated && who.aal === 'aal2') redirect(next)
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-bold">Sign in</h1>
      {sp.confirmed && (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          Email confirmed. You can sign in now.
        </p>
      )}
      {sp.reset && (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          Your password was changed. Sign in with the new one.
        </p>
      )}
      {sp.error && (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          That confirmation link is invalid or has expired. Create your account again or sign in.
        </p>
      )}
      <SignInForm next={next} />
    </Card>
  )
}
