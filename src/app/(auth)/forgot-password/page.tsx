import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Forgot password' }
export default function ForgotPasswordPage() {
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-bold">Forgot your password?</h1>
      <ForgotPasswordForm />
    </Card>
  )
}
