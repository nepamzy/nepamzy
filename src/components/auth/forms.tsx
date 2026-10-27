'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/fields'
import {
  requestPasswordResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type FormState,
} from '@/server/modules/identity-and-access/actions'

const initial: FormState = {}

function Notice({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p
        role="alert"
        className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
      >
        {state.error}
      </p>
    )
  if (state.message)
    return (
      <p
        role="status"
        className="rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
      >
        {state.message}
      </p>
    )
  return null
}

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <input type="hidden" name="next" value={next} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.email ?? ''}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <fieldset className="rounded-[var(--radius-control)] border border-line bg-accent-50/60 p-3">
        <legend className="px-1 text-sm font-bold text-navy-900">Sign in to (optional)</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <label className="touch-target flex items-center gap-2 font-semibold">
            <input type="radio" name="mode" value="customer" /> Customer
          </label>
          <label className="touch-target flex items-center gap-2 font-semibold">
            <input type="radio" name="mode" value="admin" /> Administrator
          </label>
        </div>
        <p className="text-xs text-muted">
          Only for accounts that have administrator access; everyone else is signed in as a
          customer. Leave both unticked to sign in as usual. You can switch at any time after
          signing in.
        </p>
      </fieldset>
      <Button type="submit" variant="gold" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm">
        <Link className="font-semibold text-brand-700 underline" href="/forgot-password">
          Forgot your password?
        </Link>
      </p>
      <p className="text-center text-sm text-muted">
        New here?{' '}
        <Link className="font-semibold text-brand-700 underline" href="/signup">
          Create an account
        </Link>
      </p>
    </form>
  )
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initial)
  if (state.ok) return <Notice state={state} />
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters with a lowercase letter, an uppercase letter and a number."
      />
      <Input
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <Checkbox name="adult" label="I confirm that I am 18 years old or older." required />
      <p className="text-sm text-muted">
        AFIT Market is only for people aged 18 and over. This is your own confirmation: we record
        that you made it, but we do not check your age or identity. The terms and privacy notice are
        drafts awaiting review and are not published yet.
      </p>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted">
        You will set up a second step (an authenticator app) before you can place orders.
      </p>
      <p className="text-center text-sm text-muted">
        Already registered?{' '}
        <Link className="font-semibold text-brand-700 underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  )
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.email ?? ''}
        hint="We will send a 6-digit code to the email you used to open your account."
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send me a code'}
      </Button>
    </form>
  )
}

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initial)
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.email ?? email}
      />
      <Input
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
      />
      <Input
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters with upper case, lower case and a number."
      />
      <Input
        label="Repeat new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save password and sign in'}
      </Button>
      <p className="text-center text-sm text-muted">
        No code?{' '}
        <Link className="font-semibold text-brand-700 underline" href="/forgot-password">
          Send a new one
        </Link>
      </p>
    </form>
  )
}
