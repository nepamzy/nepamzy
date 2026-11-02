'use client'
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Checkbox, Input } from '@/components/ui/fields'
import { SignatureStatement } from './signature-statement'
import {
  requestPasswordResetAction,
  resendConfirmationAction,
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

/** `staff` is the hidden administrator entrance (/staff-login): it only hides the sign-up link. */
export function SignInForm({ next, staff = false }: { next: string; staff?: boolean }) {
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
      <Button type="submit" variant="gold" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm">
        <Link className="font-semibold text-brand-700 underline" href="/forgot-password">
          Forgot your password?
        </Link>
      </p>
      {!staff && (
        <p className="text-center text-sm text-muted">
          New here?{' '}
          <Link className="font-semibold text-brand-700 underline" href="/signup">
            Create an account
          </Link>
        </p>
      )}
    </form>
  )
}

/** What to do after creating an account: where the link is, how to ask for it again, and how to carry on. */
function SignUpDone({ email, message }: { email: string; message?: string }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, initial)
  return (
    <div className="space-y-4" data-testid="signup-done">
      <p className="text-center text-5xl" aria-hidden="true">
        ✉️
      </p>
      <h2 className="text-center text-xl font-bold">Check your email</h2>
      <Notice state={{ message: message ?? `We sent a confirmation link to ${email}.` }} />
      <ol className="list-decimal space-y-1 pl-6">
        <li>
          Open the message from <strong>AFIT Market</strong> sent to <strong>{email}</strong>.
        </li>
        <li>
          Tap <strong>Confirm my e-mail</strong>.
        </li>
        <li>Then sign in to continue.</li>
      </ol>
      <p className="text-sm text-muted">
        Nothing there after a minute? Look in Spam or Promotions, then ask for a new link below.
      </p>
      <form action={action} className="space-y-2">
        <input type="hidden" name="email" value={email} />
        {state.error && (
          <p role="alert" className="font-medium text-danger-700">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p role="status" className="font-medium text-success-700">
            {state.message}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={pending} className="w-full">
          {pending ? 'Sending…' : 'Send the confirmation e-mail again'}
        </Button>
      </form>
      <Link
        href="/login"
        className="touch-target flex w-full items-center justify-center rounded-[var(--radius-control)] bg-gold-400 px-4 font-bold text-ink hover:bg-gold-500"
      >
        I have confirmed: sign in
      </Link>
      <p className="text-center text-sm text-muted">
        Wrong address?{' '}
        <a className="font-semibold text-brand-700 underline" href="/signup">
          Start again
        </a>
      </p>
    </div>
  )
}

type Intent = 'customer' | 'vendor' | 'rider'
type PersonType = 'student' | 'military' | 'lecturer' | 'other'

/** Shrinks a photo to a JPEG small enough to send with the form (about 500 KB at most). */
async function shrinkToJpeg(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const url = c.toDataURL('image/jpeg', q)
      if (url.length < 640_000) return url
    }
    return null
  } catch {
    return null
  }
}

const ROLE_HELP: Record<Intent, [string, string]> = {
  customer: ['Customer', 'Buy food and items and get them delivered or ready for pickup.'],
  vendor: [
    'Vendor',
    'Sell items. You apply with your shop details and are approved before you can sell.',
  ],
  rider: ['Rider', 'Deliver orders. You apply and are approved before you can deliver.'],
}
const TYPE_LABEL: Record<PersonType, string> = {
  student: 'Student',
  military: 'Military',
  lecturer: 'Lecturer',
  other: 'Other',
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initial)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [intent, setIntent] = useState<Intent>('customer')
  const [personType, setPersonType] = useState<PersonType | null>(null)
  const [studentId, setStudentId] = useState('')
  const [idCard, setIdCard] = useState<string | null>(null)
  const [idSaved, setIdSaved] = useState(false)
  const [signed, setSigned] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (state.ok) return <SignUpDone email={state.email ?? ''} message={state.message} />

  const isStudent = intent === 'customer' && personType === 'student'
  const step1Ready =
    intent !== 'customer' ||
    (personType !== null && (personType !== 'student' || (idSaved && !!idCard)))
  const goNext = () => {
    setProblem(null)
    if (step === 1) {
      if (intent === 'customer' && !personType)
        return setProblem('Choose whether you are a student, military, a lecturer or other.')
      if (isStudent && !idSaved) return setProblem('Save your ID card first.')
      return setStep(2)
    }
    if (step === 2) {
      if (!signed) return setProblem('Please sign in the box first.')
      return setStep(3)
    }
  }
  const saveCard = () => {
    setProblem(null)
    if (studentId.trim().length < 3) return setProblem('Enter your student ID card number.')
    if (!idCard) return setProblem('Add a clear photo of your student ID card.')
    setIdSaved(true)
  }
  const stepTitle = ['Who are you?', 'Your signature', 'Your account'][step - 1]!

  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <p className="text-sm font-semibold text-muted" data-testid="signup-step">
        Step {step} of 3: {stepTitle}
      </p>
      {problem && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {problem}
        </p>
      )}
      <input type="hidden" name="intent" value={intent} />
      {intent === 'customer' && personType && (
        <input type="hidden" name="personType" value={personType} />
      )}
      {isStudent && <input type="hidden" name="studentId" value={studentId} />}
      {isStudent && idCard && <input type="hidden" name="idCard" value={idCard} />}

      <div className={step === 1 ? 'space-y-4' : 'hidden'}>
        <fieldset className="rounded-[var(--radius-control)] border border-line bg-accent-50/60 p-3">
          <legend className="px-1 text-sm font-bold text-navy-900">
            I want to use AFIT Market as a
          </legend>
          <div className="space-y-1">
            {(Object.keys(ROLE_HELP) as Intent[]).map((value) => (
              <label key={value} className="touch-target flex items-start gap-2">
                <input
                  type="radio"
                  name="intent-choice"
                  value={value}
                  checked={intent === value}
                  onChange={() => {
                    setIntent(value)
                    setProblem(null)
                  }}
                  className="mt-1.5"
                />
                <span>
                  <span className="font-semibold">{ROLE_HELP[value][0]}</span>
                  <span className="block text-sm text-muted">{ROLE_HELP[value][1]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Choosing Vendor or Rider takes you to the application after you sign in; nothing is
            switched on until it is approved.
          </p>
        </fieldset>

        {intent === 'customer' && (
          <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
            <legend className="px-1 text-sm font-bold text-navy-900">I am a</legend>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(TYPE_LABEL) as PersonType[]).map((t) => (
                <label key={t} className="touch-target flex items-center gap-2">
                  <input
                    type="radio"
                    name="person-choice"
                    value={t}
                    checked={personType === t}
                    onChange={() => {
                      setPersonType(t)
                      setProblem(null)
                    }}
                  />
                  <span className="font-semibold">{TYPE_LABEL[t]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {isStudent && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
            <p className="font-semibold text-navy-900">Your student ID card</p>
            {idSaved ? (
              <div className="space-y-2">
                <p role="status" className="font-medium text-success-700">
                  Your ID card will be reviewed.
                </p>
                <p className="text-sm">ID number: {studentId.trim().toUpperCase()}</p>
                <Button type="button" variant="secondary" onClick={() => setIdSaved(false)}>
                  Edit ID card
                </Button>
              </div>
            ) : (
              <>
                <Input
                  label="Student ID card number"
                  name="studentIdInput"
                  autoComplete="off"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                />
                <div className="space-y-1">
                  <label htmlFor="idcard-file" className="text-sm font-semibold">
                    Photo of your new student ID card (2026 edition)
                  </label>
                  <input
                    id="idcard-file"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="block w-full text-sm"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      const url = f ? await shrinkToJpeg(f) : null
                      setIdCard(url)
                      if (f && !url) setProblem('That photo could not be used. Try another one.')
                    }}
                  />
                  <p className="text-xs text-muted">
                    Take it flat in good light, with all four corners and the text readable.
                  </p>
                </div>
                <Button type="button" onClick={saveCard}>
                  Save ID card
                </Button>
              </>
            )}
          </div>
        )}
        <Button type="button" onClick={goNext} disabled={!step1Ready} className="w-full">
          Next
        </Button>
      </div>

      {/* The signature box stays on the page (hidden) so a drawn signature is not lost when moving between steps. */}
      <div className={step === 2 ? 'space-y-4' : 'hidden'}>
        <SignatureStatement />
        <SignaturePad
          label="Sign here"
          hint="Sign with your finger or a stylus."
          onSignedChange={setSigned}
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button type="button" onClick={goNext} disabled={!signed} className="flex-1">
            Next
          </Button>
        </div>
      </div>

      <div className={step === 3 ? 'space-y-4' : 'hidden'}>
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
          that you made it, but we do not check your age. The terms and privacy notice are drafts
          awaiting review and are not published yet.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setStep(2)}>
            Back
          </Button>
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </div>
        <p className="text-center text-sm text-muted">
          An authenticator app for extra security is optional. You can add one later from Account,
          then Security.
        </p>
      </div>
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
