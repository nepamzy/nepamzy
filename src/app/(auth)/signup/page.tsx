import type { Metadata } from 'next'
import { SignUpForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Create account' }
export default function SignUpPage() {
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-bold">Create your account</h1>
      <SignUpForm />
    </Card>
  )
}
