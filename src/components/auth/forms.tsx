'use client'
import jsQR from 'jsqr'
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { SignaturePad } from '@/components/domain/signature-pad'
import { Checkbox, Input } from '@/components/ui/fields'
import {
  VendorChoices,
  vendorChoicesReady,
  type CategoryChoice,
  type VendorChoicesState,
} from '@/components/domain/vendor-choices'
import { SignatureStatement } from './signature-statement'
import { RolePhoto } from '@/components/landing/role-photo'
import { Watermark } from '@/components/landing/watermark'
import {
  requestPasswordResetAction,
  confirmEmailCodeAction,
  resendConfirmationAction,
  resetPasswordAction,
  signInAction,
  saveMatricAction,
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
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        defaultValue={state.email ?? ''}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
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

/** After creating an account: type the code from the e-mail. Resend it, go back to sign in, or start again from here. */
function SignUpDone({ email, message }: { email: string; message?: string }) {
  const [resend, resendAction, resending] = useActionState(resendConfirmationAction, initial)
  const [confirm, confirmAction, confirming] = useActionState(confirmEmailCodeAction, initial)
  return (
    <div className="space-y-4" data-testid="signup-done">
      <p className="text-center text-5xl" aria-hidden="true">
        ✉️
      </p>
      <h2 className="text-center text-xl font-bold">Check your email</h2>
      <Notice state={{ message: message ?? `We sent a confirmation code to ${email}.` }} />
      <form action={confirmAction} className="space-y-3" noValidate>
        <input type="hidden" name="email" value={email} />
        {confirm.error && (
          <p role="alert" className="font-medium text-danger-700">
            {confirm.error}
          </p>
        )}
        <Input
          label="Confirmation code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          required
          hint={`Open the message from AFIT Market sent to ${email}, copy the code and paste it here.`}
        />
        <Button type="submit" variant="gold" disabled={confirming} className="w-full">
          {confirming ? 'Checking…' : 'Confirm my email'}
        </Button>
      </form>
      <p className="text-sm text-muted">
        Nothing there after a minute? Look in Spam or Promotions, then ask for a new code.
      </p>
      <form action={resendAction} className="space-y-2">
        <input type="hidden" name="email" value={email} />
        {resend.error && (
          <p role="alert" className="font-medium text-danger-700">
            {resend.error}
          </p>
        )}
        {resend.ok && resend.message && (
          <p role="status" className="font-medium text-success-700">
            {resend.message}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={resending} className="w-full">
          {resending ? 'Sending…' : 'Send me a new code'}
        </Button>
      </form>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/login"
          className="touch-target flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong px-4 font-bold text-navy-900 hover:bg-brand-50"
        >
          Back to sign in
        </Link>
        <a
          href="/signup"
          className="touch-target flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong px-4 font-bold text-navy-900 hover:bg-brand-50"
        >
          Use a different email
        </a>
      </div>
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

/** The same photo as it will be sent (shrunk), and whether a QR code can be read in it. Only the NEW student ID card has one on the front. */
async function readCard(file: File): Promise<{ url: string; qr: boolean } | null> {
  const url = await shrinkToJpeg(file)
  if (!url) return null
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height)
    const code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })
    return { url, qr: Boolean(code) }
  } catch {
    return { url, qr: false }
  }
}

/** A Nigerian mobile number as people type it: 0803 123 4567 or +234 803 123 4567. */
const looksLikePhone = (v: string) =>
  /^(?:\+234|234|0)[789][01]\d{8}$/.test(v.replace(/[\s()-]/g, ''))

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

/** Small flat badges for the "I am a" choices. Decorative: the words beside them carry the meaning. */
function PersonIcon({ kind }: { kind: PersonType }) {
  const common = {
    viewBox: '0 0 48 48',
    className: 'size-10',
    'aria-hidden': true,
    focusable: false,
  } as const
  if (kind === 'student')
    return (
      <svg {...common}>
        <circle cx="24" cy="24" r="22" className="fill-gold-400/30" />
        <path d="M24 12 6 21l18 9 18-9z" className="fill-navy-900" />
        <path d="M13 26v8c0 3 5 6 11 6s11-3 11-6v-8l-11 5z" className="fill-brand-700" />
        <path d="M40 22v12" stroke="rgb(255 201 40)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  if (kind === 'military')
    return (
      <svg {...common}>
        <circle cx="24" cy="24" r="22" className="fill-brand-50" />
        <path d="M24 7 38 12v11c0 8-6 14-14 18C16 37 10 31 10 23V12z" className="fill-navy-900" />
        <path
          d="m24 15 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"
          className="fill-gold-400"
        />
      </svg>
    )
  if (kind === 'lecturer')
    return (
      <svg {...common}>
        <circle cx="24" cy="24" r="22" className="fill-gold-400/30" />
        <rect x="8" y="10" width="32" height="20" rx="3" className="fill-navy-900" />
        <path
          d="M14 17h14M14 22h20M14 26h9"
          stroke="rgb(255 255 255)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M18 40 24 30l6 10" stroke="rgb(11 42 92)" strokeWidth="3" fill="none" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="24" cy="24" r="22" className="fill-brand-50" />
      <circle cx="24" cy="18" r="7" className="fill-navy-900" />
      <path d="M10 40c1-9 7-13 14-13s13 4 14 13z" className="fill-brand-700" />
    </svg>
  )
}

export function SignUpForm({ categories = [] }: { categories?: CategoryChoice[] }) {
  const [state, action, pending] = useActionState(signUpAction, initial)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [intent, setIntent] = useState<Intent>('customer')
  const [personType, setPersonType] = useState<PersonType | null>(null)
  const [studentId, setStudentId] = useState('')
  const [idCard, setIdCard] = useState<string | null>(null)
  const [idBack, setIdBack] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [vendor, setVendor] = useState<VendorChoicesState>({
    vendorType: '',
    categories: [],
    other: '',
    place: '',
  })
  const [frontQr, setFrontQr] = useState<'none' | 'ok' | 'noqr'>('none')
  const [signed, setSigned] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (state.ok) return <SignUpDone email={state.email ?? ''} message={state.message} />

  const isRider = intent === 'rider'
  const isVendor = intent === 'vendor'
  const isStudent =
    (intent === 'customer' && personType === 'student') ||
    (isVendor && vendor.vendorType === 'student')
  const riderReady =
    studentId.trim().length >= 3 &&
    looksLikePhone(phone) &&
    !!idCard &&
    !!idBack &&
    frontQr === 'ok'
  const step1Ready = isRider
    ? riderReady
    : isVendor
      ? vendorChoicesReady(vendor, categories) &&
        (vendor.vendorType !== 'student' || studentId.trim().length >= 3)
      : intent !== 'customer' ||
        (personType !== null && (personType !== 'student' || studentId.trim().length >= 3))
  const goNext = () => {
    setProblem(null)
    if (step === 1) {
      if (isVendor) {
        if (!vendor.vendorType)
          return setProblem(
            'Choose whether you are a student, a shop AFIT already knows, or other.',
          )
        if (vendor.categories.length === 0) return setProblem('Choose what your shop will sell.')
        if (!vendorChoicesReady(vendor, categories))
          return setProblem(
            vendor.vendorType === 'afit_shop' && vendor.place.trim().length < 3
              ? 'Say where your shop is on campus.'
              : 'Tell us what else your shop will sell.',
          )
      }
      if (intent === 'customer' && !personType)
        return setProblem('Choose whether you are a student, military, a lecturer or other.')
      if (isStudent && studentId.trim().length < 3) return setProblem('Enter your matric number.')
      if (isRider) {
        if (studentId.trim().length < 3) return setProblem('Enter your matric number.')
        if (!looksLikePhone(phone))
          return setProblem('Enter a valid Nigerian phone number, for example 0803 123 4567.')
        if (!idCard) return setProblem('Add a clear photo of the front of your ID card.')
        if (frontQr !== 'ok')
          return setProblem(
            'The front of your ID card must show the QR code. Only the new ID card has one.',
          )
        if (!idBack) return setProblem('Add a clear photo of the back of your ID card.')
      }
      return setStep(2)
    }
    if (step === 2) {
      if (!signed) return setProblem('Please sign in the box first.')
      return setStep(3)
    }
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
      {(isStudent || isRider) && <input type="hidden" name="studentId" value={studentId} />}
      {(isStudent || isRider) && idCard && <input type="hidden" name="idCard" value={idCard} />}
      {isRider && <input type="hidden" name="phone" value={phone} />}
      {isRider && idBack && <input type="hidden" name="idCardBack" value={idBack} />}
      {isVendor && vendor.vendorType === 'student' && (
        <input type="hidden" name="personType" value="student" />
      )}

      <div className={step === 1 ? 'space-y-4' : 'hidden'}>
        <fieldset className="relative isolate overflow-hidden rounded-[var(--radius-control)] border border-line bg-accent-50/60 p-3">
          <Watermark />
          <legend className="relative z-10 px-1 text-sm font-bold text-navy-900">
            I want to use AFIT Market as a
          </legend>
          <div className="relative z-10 grid gap-2 sm:grid-cols-3">
            {(Object.keys(ROLE_HELP) as Intent[]).map((value) => {
              return (
                <label
                  key={value}
                  className="touch-target group relative flex cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border-2 border-line bg-white p-3 transition hover:-translate-y-0.5 hover:border-brand-600 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:checked]:shadow-[var(--shadow-card)] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold-400/60 sm:flex-col sm:text-center"
                >
                  <input
                    type="radio"
                    name="intent-choice"
                    value={value}
                    checked={intent === value}
                    onChange={() => {
                      setIntent(value)
                      setProblem(null)
                    }}
                    className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  />
                  <RolePhoto
                    kind={value}
                    className="size-20 shrink-0 transition-transform duration-300 group-hover:scale-105 group-has-[:checked]:scale-105 sm:size-28"
                  />
                  <span>
                    <span className="block font-bold text-navy-900">{ROLE_HELP[value][0]}</span>
                    <span className="block text-sm text-muted">{ROLE_HELP[value][1]}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 hidden size-6 place-items-center rounded-full bg-brand-700 text-xs font-extrabold text-white group-has-[:checked]:grid"
                  >
                    ✓
                  </span>
                </label>
              )
            })}
          </div>
          <p className="relative z-10 mt-2 text-xs text-muted">
            Choosing Vendor or Rider takes you to the application after you sign in; nothing is
            switched on until it is approved.
          </p>
        </fieldset>

        {intent === 'customer' && (
          <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
            <legend className="px-1 text-sm font-bold text-navy-900">I am a</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(TYPE_LABEL) as PersonType[]).map((t) => (
                <label
                  key={t}
                  className="touch-target relative flex cursor-pointer flex-col items-center gap-1 rounded-[var(--radius-control)] border-2 border-line bg-white px-2 py-3 text-center transition hover:border-brand-600 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-gold-400/60"
                >
                  <input
                    type="radio"
                    name="person-choice"
                    value={t}
                    checked={personType === t}
                    onChange={() => {
                      setPersonType(t)
                      setProblem(null)
                    }}
                    className="absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
                  />
                  <PersonIcon kind={t} />
                  <span className="font-semibold">{TYPE_LABEL[t]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {isVendor && (
          <VendorChoices
            categories={categories}
            onChange={(v) => {
              setVendor(v)
              setProblem(null)
            }}
          />
        )}

        {isStudent && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
            <Input
              label="Matric number"
              name="studentIdInput"
              autoComplete="off"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            />
            <div className="space-y-1">
              <label htmlFor="idcard-file" className="text-sm font-semibold">
                Photo of your student ID card (optional)
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
                You can skip this now. You can add your matric number or card later under Security
                in your account.
              </p>
            </div>
          </div>
        )}
        {isRider && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
            <p className="font-semibold text-navy-900">Rider details</p>
            <Input
              label="Matric number"
              name="riderMatricInput"
              autoComplete="off"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            />
            <Input
              label="Phone number"
              name="riderPhoneInput"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint="For example 0803 123 4567"
            />
            <div className="space-y-1">
              <label htmlFor="rider-id-front" className="text-sm font-semibold">
                Photo of the FRONT of your new student ID card
              </label>
              <input
                id="rider-id-front"
                type="file"
                accept="image/*"
                capture="environment"
                className="block w-full text-sm"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  setProblem(null)
                  setIdCard(null)
                  setFrontQr('none')
                  if (!f) return
                  const r = await readCard(f)
                  if (!r) return setProblem('That photo could not be used. Try another one.')
                  setIdCard(r.url)
                  setFrontQr(r.qr ? 'ok' : 'noqr')
                }}
              />
              {frontQr === 'ok' && (
                <p role="status" className="text-sm font-medium text-success-700">
                  QR code found on the front of your card.
                </p>
              )}
              {frontQr === 'noqr' && (
                <p role="alert" className="text-sm font-medium text-danger-700">
                  We cannot see a QR code on the front of this card. Only the new ID card has one.
                  Take a clear, flat photo of the whole front, or use your new card.
                </p>
              )}
              <p className="text-xs text-muted">
                Take it flat, in good light, with all four corners and the QR code showing.
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="rider-id-back" className="text-sm font-semibold">
                Photo of the BACK of your ID card
              </label>
              <input
                id="rider-id-back"
                type="file"
                accept="image/*"
                capture="environment"
                className="block w-full text-sm"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  setProblem(null)
                  setIdBack(null)
                  if (!f) return
                  const url = await shrinkToJpeg(f)
                  if (!url) return setProblem('That photo could not be used. Try another one.')
                  setIdBack(url)
                }}
              />
              {idBack && (
                <p role="status" className="text-sm font-medium text-success-700">
                  Back of the card added.
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <ButtonLink href="/" variant="secondary" data-testid="signup-back-home">
            Back
          </ButtonLink>
          <Button type="button" onClick={goNext} disabled={!step1Ready} className="flex-1">
            Next
          </Button>
        </div>
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

/** Security page: add or change the matric number. */
export function MatricForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(saveMatricAction, initial)
  return (
    <form action={action} className="space-y-3" noValidate>
      <Notice state={state} />
      <Input
        label="Matric number"
        name="matric"
        autoComplete="off"
        defaultValue={current ?? ''}
        hint="Students: your matriculation number. Only you and AFIT Market staff can see it."
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save matric number'}
      </Button>
    </form>
  )
}
