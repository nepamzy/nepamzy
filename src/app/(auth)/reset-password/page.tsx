import type { Metadata } from 'next'
import { ResetPasswordForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Choose a new password' }
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const email = ((await searchParams).email ?? '').slice(0, 254)
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-bold">Check your email</h1>
      <p className="mb-4 text-muted">
        If that email has an account, we sent a 6-digit code. Enter it with your new password and
        you will be signed in.
      </p>
      <ResetPasswordForm email={email} />
    </Card>
  )
}
