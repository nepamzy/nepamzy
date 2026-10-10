'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { signInAction, signUpAction, type FormState } from '@/server/modules/identity-and-access/actions'

const initial: FormState = {}

function Notice({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700">{state.error}</p>
  if (state.message) return <p role="status" className="rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700">{state.message}</p>
  return null
}

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <input type="hidden" name="next" value={next} />
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.email ?? ''} />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Signing in…' : 'Sign in'}</Button>
      <p className="text-center text-sm text-muted">New here? <Link className="font-semibold text-brand-700 underline" href="/signup">Create an account</Link></p>
    </form>
  )
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initial)
  if (state.ok) return <Notice state={state} />
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <Input label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
      <Input label="Password" name="password" type="password" autoComplete="new-password" required
        hint="At least 10 characters with a lowercase letter, an uppercase letter and a number." />
      <Input label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Creating account…' : 'Create account'}</Button>
      <p className="text-center text-sm text-muted">You will set up a second step (an authenticator app) before you can place orders.</p>
      <p className="text-center text-sm text-muted">Already registered? <Link className="font-semibold text-brand-700 underline" href="/login">Sign in</Link></p>
    </form>
  )
}
