'use server'

import {
  notifyPasswordChanged,
  notifySignIn,
  notifyWelcome,
} from '@/server/modules/engagement/dispatch'
import { notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createHmac, randomInt } from 'node:crypto'
import { after } from 'next/server'
import { serverEnv, serviceEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { confirmEmail, resetCodeEmail } from '@/server/modules/engagement/email-templates'
import { mailConfig, sendMail, sendMailDetailed } from '@/server/modules/engagement/mail'
import { parseSignature } from '@/server/modules/orders-and-state-machine/signature'
import { checkAccess, loadPrincipal } from './guard'
import {
  PERSON_TYPES,
  hasSignature,
  parseIdCard,
  saveIdentity,
  saveMatricNumber,
  saveSignature,
  validStudentId,
  type PersonType,
} from './identity'
import { experienceOf, homeFor, isPrivilegedRole, safeNextPath, signUpOutcome } from './policy'
import { clientIp, rateLimit, recordSecurityEvent, sha256Hex } from './security'

export type FormState = { ok?: boolean; error?: string; message?: string; email?: string }

const emailSchema = z
  .email('Enter a valid email address.')
  .max(254)
  .transform((e) => e.trim().toLowerCase())
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use 72 characters or fewer.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.')

const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirm: z.string(),
    adult: z.literal('on', { error: 'Confirm that you are 18 years old or older to register.' }),
    // What the person wants to do here. It only decides which application page they are shown after signing in;
    // it never grants a role (vendors and riders are approved by an administrator).
    intent: z.enum(['customer', 'vendor', 'rider']).catch('customer'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match.',
    path: ['confirm'],
  })

const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.'

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    adult: formData.get('adult'),
    intent: formData.get('intent'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }
  const { email, password, intent } = parsed.data
  // The signature chosen at sign-up, and (customers only) the kind of customer and, for students, the ID details.
  const sig = parseSignature(String(formData.get('signature') ?? ''))
  if (!sig.ok) return { error: 'Please sign in the signature box before creating your account.' }
  let personType: PersonType | null = null
  let studentId: string | undefined
  let idCard: Buffer | undefined
  if (intent === 'customer') {
    const t = String(formData.get('personType') ?? '')
    if (!PERSON_TYPES.includes(t as PersonType))
      return { error: 'Choose whether you are a student, military, a lecturer or other.' }
    personType = t as PersonType
    if (personType === 'student') {
      studentId = String(formData.get('studentId') ?? '').trim()
      if (!validStudentId(studentId)) return { error: 'Enter your matric number.' }
      // the ID card photo is optional; a photo that cannot be used is simply not kept
      const rawCard = String(formData.get('idCard') ?? '')
      if (rawCard) {
        const card = parseIdCard(rawCard)
        if (card.ok) idCard = card.jpeg
      }
    }
  }
  const ip = await clientIp()
  if (
    !(await rateLimit(`signup:ip:${ip}`, 3600, 10)) ||
    !(await rateLimit(`signup:email:${sha256Hex(email)}`, 3600, 3))
  ) {
    return { error: TOO_MANY }
  }
  const metadata = {
    adult_declared: true,
    ...(intent === 'customer' ? {} : { intended_role: intent }),
  }
  const mail = mailConfig()
  const supabase = await createSupabaseServerClient()
  let error: { code?: string; status?: number } | null = null
  let data: { session?: unknown; user?: { id: string } | null } | null = null
  let newUserId: string | null = null
  let sentByUs = false
  if (mail) {
    // Our own e-mail: the confirmation link is made here and sent through Brevo, so it does not depend on the auth
    // provider's built-in mailer (which is heavily limited). The link is the same kind of one-time token.
    const svc = createSupabaseServiceClient()
    const gen = await svc.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { data: metadata, redirectTo: `${serverEnv().SITE_URL}/auth/confirm` },
    })
    if (gen.error) {
      error = { code: gen.error.code, status: gen.error.status }
    } else {
      newUserId = gen.data.user?.id ?? null
      const hashed = gen.data.properties?.hashed_token
      const link = `${serverEnv().SITE_URL}/auth/confirm?token_hash=${encodeURIComponent(hashed ?? '')}&type=signup`
      const code = gen.data.properties?.email_otp
      const out = await sendMailDetailed(email, confirmEmail(link, serverEnv().SITE_URL, code), {
        config: mail,
      })
      sentByUs = out.result === 'sent'
      if (!sentByUs) {
        logger.warn('confirmation e-mail not sent', { status: out.status, reason: out.reason })
        // Last resort: ask the auth provider's own mailer to send the confirmation instead.
        await supabase.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: `${serverEnv().SITE_URL}/auth/confirm` },
        })
      }
    }
  } else {
    const r = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${serverEnv().SITE_URL}/auth/confirm`, data: metadata },
    })
    error = r.error
    data = r.data
    newUserId = r.data?.user?.id ?? null
  }
  const outcome = signUpOutcome({ error, hasSession: Boolean(data?.session) })
  if (outcome === 'weak_password') return { error: 'Choose a stronger password.' }
  if (outcome === 'unavailable')
    return { error: 'We could not create your account right now. Please try again.' }
  if (outcome === 'exists')
    return { error: 'An account with this email already exists. Try signing in instead.', email }
  if (!error) notifyAdmin({ type: 'signup', email })
  // Keep what they told us. A failure here never blocks the account: the signature is asked for again at sign-in.
  if (!error && newUserId) {
    try {
      await saveSignature(newUserId, String(formData.get('signature') ?? ''))
      if (personType) await saveIdentity(newUserId, { personType, studentId, idCard })
    } catch (e) {
      logger.warn('sign-up details not saved', { err: e instanceof Error ? e.name : 'error' })
    }
  }
  // E-mail confirmation is switched off in the provider settings: the person is already signed in.
  if (outcome === 'signed_in') {
    notifyWelcome(email)
    redirect(applicationPathFor(intent) ?? '/')
  }
  // Same message whether or not the address already exists (prevents account enumeration).
  return {
    ok: true,
    email,
    message:
      intent === 'customer'
        ? 'Check your email. We sent you a confirmation code.'
        : `Check your email. We sent you a confirmation code. After you confirm and sign in, you will be taken to the ${intent} application.`,
  }
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const emailParsed = emailSchema.safeParse(formData.get('email'))
  const password = String(formData.get('password') ?? '')
  const next = safeNextPath(String(formData.get('next') ?? ''))
  if (!emailParsed.success || !password)
    return {
      error: 'Enter your email and password.',
      email: String(formData.get('email') ?? '').slice(0, 254),
    }
  const email = emailParsed.data
  const emailKey = sha256Hex(email)
  const ip = await clientIp()
  if (
    !(await rateLimit(`login:ip:${ip}`, 900, 30)) ||
    !(await rateLimit(`login:email:${emailKey}`, 900, 10))
  ) {
    await recordSecurityEvent(null, 'auth.login_rate_limited', {
      email_hash: emailKey.slice(0, 16),
    })
    return { error: TOO_MANY, email }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    if (error?.code === 'email_not_confirmed') {
      await resendConfirmation(email)
      return {
        error:
          'Please confirm your email first. We have just sent you a fresh confirmation link; check your inbox and spam folder.',
        email,
      }
    }
    await recordSecurityEvent(null, 'auth.login_failed', { email_hash: emailKey.slice(0, 16) })
    return { error: 'Email or password is incorrect.', email }
  }
  notifySignIn(email, (await headers()).get('user-agent'))
  return finishSignIn(next, data.user.user_metadata?.intended_role)
}

/** A fresh confirmation link for an address that signed up but never confirmed. At most one every 5 minutes per address. */
async function resendConfirmation(email: string): Promise<'done' | 'wait'> {
  try {
    if (!(await rateLimit(`confirm-resend:${sha256Hex(email)}`, 300, 1))) return 'wait'
    const mail = mailConfig()
    if (mail) {
      const gen = await createSupabaseServiceClient().auth.admin.generateLink({
        type: 'magiclink',
        email,
      })
      const hashed = gen.data?.properties?.hashed_token
      if (!gen.error && hashed) {
        const link = `${serverEnv().SITE_URL}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink`
        const out = await sendMailDetailed(
          email,
          confirmEmail(link, serverEnv().SITE_URL, gen.data?.properties?.email_otp),
          { config: mail },
        )
        if (out.result === 'sent') return 'done'
        logger.warn('confirmation e-mail not sent', { status: out.status, reason: out.reason })
      }
    }
    const supabase = await createSupabaseServerClient()
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${serverEnv().SITE_URL}/auth/confirm` },
    })
  } catch {
    /* best effort */
  }
  return 'done'
}

/** "Send me the confirmation e-mail again" on the page shown after sign-up. The answer never says whether the address has an account. */
export async function resendConfirmationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) return { error: 'Enter a valid email address.' }
  const email = parsed.data
  const ip = await clientIp()
  if (!(await rateLimit(`resend:ip:${ip}`, 3600, 10))) return { error: TOO_MANY, email }
  const r = await resendConfirmation(email)
  if (r === 'wait')
    return {
      error: 'We sent one a moment ago. Please wait a few minutes before asking for another.',
      email,
    }
  return {
    ok: true,
    email,
    message: `If ${email} is waiting for confirmation, we have sent a fresh code. It can take a minute. Check Spam too.`,
  }
}

/** The code from the confirmation e-mail, typed or pasted on the page shown after sign-up. */
export async function confirmEmailCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) return { error: 'Enter a valid email address.' }
  const email = parsed.data
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '')
  if (!/^[0-9]{6,8}$/.test(code))
    return { error: 'Enter the code from the email (numbers only).', email }
  const ip = await clientIp()
  if (
    !(await rateLimit(`confirm-code:ip:${ip}`, 900, 30)) ||
    !(await rateLimit(`confirm-code:email:${sha256Hex(email)}`, 900, 8))
  )
    return { error: TOO_MANY, email }
  const supabase = await createSupabaseServerClient()
  // A fresh code may have been made for a sign-up or as a sign-in code: the same one-time number, tried by kind.
  for (const type of ['signup', 'email', 'magiclink'] as const) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type })
    if (!error && data.user) {
      notifyWelcome(email)
      // Do not keep the confirmation session: the person signs in normally (password, and the second step if set).
      await supabase.auth.signOut({ scope: 'local' })
      redirect('/login?confirmed=1')
    }
  }
  return {
    error:
      'That code is not right, or it has expired. Check the newest email from AFIT Market, or ask for a new code below.',
    email,
  }
}

/** Where a person who signed up as a vendor or rider continues (their application). Everyone else: null. */
function applicationPathFor(intent: unknown): '/apply' | '/rider-apply' | null {
  return intent === 'vendor' ? '/apply' : intent === 'rider' ? '/rider-apply' : null
}

/** After a password was accepted: staff and people with an authenticator go to the second step; others are in. */
async function finishSignIn(next: string, intent?: unknown): Promise<never> {
  const who = await loadPrincipal()
  const staff = who.roles.some(isPrivilegedRole)
  // Someone who signed up to sell or deliver is taken to that application until they hold the role.
  const holds = intent === 'vendor' ? 'vendor_owner' : intent === 'rider' ? 'rider' : null
  if (next === '/' && holds && !who.roles.includes(holds)) next = applicationPathFor(intent) ?? next
  // A shop or a rider starts in its own area, never on the customer screens.
  if (next === '/') {
    const home = experienceOf(who)
    if (home === 'vendor' || home === 'rider') next = homeFor(home)
  }
  // Staff land in Administration.
  if (staff && next === '/') next = '/admin'
  // Everyone who signs deliveries needs a saved signature to compare against. Accounts made before this existed are
  // asked for one right after sign-in (staff accounts do not sign deliveries).
  if (who.userId && !staff && !(await hasSignature(who.userId)))
    next = `/signature-setup?next=${encodeURIComponent(next)}`
  if (who.hasVerifiedFactor) redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`)
  if (staff) redirect(`/mfa/enroll?next=${encodeURIComponent(next)}`)
  redirect(next)
}

// ------------------------------- Forgot password (e-mailed 6-digit code) -----------------------

const resetHash = (userId: string, code: string) =>
  createHmac('sha256', serviceEnv().SUPABASE_SERVICE_ROLE_KEY)
    .update(`${userId}:${code}`)
    .digest('hex')

/** Step 1: e-mail a 6-digit code. The answer is the same whether or not the address has an account. */
export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) return { error: 'Enter a valid email address.' }
  const email = parsed.data
  const ip = await clientIp()
  if (
    !(await rateLimit(`reset:ip:${ip}`, 3600, 10)) ||
    !(await rateLimit(`reset:email:${sha256Hex(email)}`, 3600, 3))
  )
    return { error: TOO_MANY, email }
  const mail = mailConfig()
  if (!mail)
    return {
      error: 'Password reset by e-mail is not switched on yet. Please contact support.',
      email,
    }
  after(async () => {
    try {
      const svc = createSupabaseServiceClient()
      const { data: uid } = await svc.rpc('auth_user_id_by_email', { p_email: email })
      if (typeof uid !== 'string') return
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      const { error } = await svc.rpc('password_reset_issue', {
        p_user: uid,
        p_hash: resetHash(uid, code),
      })
      if (error) return
      await sendMail(email, resetCodeEmail(code, serverEnv().SITE_URL), { config: mail })
      await recordSecurityEvent(uid, 'auth.password_reset_requested', {})
    } catch (e) {
      logger.warn('password reset request failed', { err: e instanceof Error ? e.name : 'error' })
    }
  })
  redirect(`/reset-password?email=${encodeURIComponent(email)}`)
}

const resetSchema = z
  .object({
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your e-mail.'),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match.',
    path: ['confirm'],
  })

/** Step 2: code + new password. A correct code proves the e-mail is theirs, so the address is also marked confirmed. */
export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetSchema.safeParse({
    email: formData.get('email'),
    code: String(formData.get('code') ?? '').replace(/\s+/g, ''),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? 'Check your details.',
      email: String(formData.get('email') ?? '').slice(0, 254),
    }
  const { email, code, password } = parsed.data
  const ip = await clientIp()
  if (
    !(await rateLimit(`resetcode:ip:${ip}`, 3600, 30)) ||
    !(await rateLimit(`resetcode:email:${sha256Hex(email)}`, 3600, 15))
  )
    return { error: TOO_MANY, email }
  const WRONG = 'That code is not right or has expired. Ask for a new one.'
  const svc = createSupabaseServiceClient()
  const { data: uid } = await svc.rpc('auth_user_id_by_email', { p_email: email })
  if (typeof uid !== 'string') return { error: WRONG, email }
  const { data: verdict } = await svc.rpc('password_reset_check', {
    p_user: uid,
    p_hash: resetHash(uid, code),
  })
  if (verdict === 'locked') return { error: 'Too many wrong codes. Ask for a new code.', email }
  if (verdict !== 'ok') return { error: WRONG, email }
  const { error } = await svc.auth.admin.updateUserById(uid, { password, email_confirm: true })
  if (error) {
    logger.warn('password reset update failed', { code: error.code })
    return { error: 'We could not save your new password. Please try again.', email }
  }
  await recordSecurityEvent(uid, 'auth.password_reset_done', {})
  notifyPasswordChanged(email)
  const supabase = await createSupabaseServerClient()
  const signedIn = await supabase.auth.signInWithPassword({ email, password })
  if (signedIn.error) redirect('/login?reset=1')
  return finishSignIn('/')
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/')
}

// ------------------------------- MFA (TOTP) -------------------------------------------------

export type EnrollStart =
  { ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string }

/** Begin TOTP enrollment. Allowed at aal1 only for the FIRST factor (Supabase enforces aal2 for more). */
export async function startEnrollmentAction(kind: 'primary' | 'backup'): Promise<EnrollStart> {
  const who = await loadPrincipal()
  if (!who.authenticated) return { ok: false, error: 'Please sign in first.' }
  if (who.hasVerifiedFactor && who.aal !== 'aal2')
    return { ok: false, error: 'Confirm your current authenticator code first.' }
  const supabase = await createSupabaseServerClient()
  // Remove abandoned, never-verified factors so retries do not pile up.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const base = kind === 'backup' ? 'Backup authenticator' : 'Authenticator app'
  const taken = new Set(
    (factors?.all ?? []).filter((f) => f.status === 'verified').map((f) => f.friendly_name),
  )
  const friendlyName = taken.has(base) ? `${base} ${taken.size + 1}` : base
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
    issuer: 'AFIT Market',
  })
  if (error || !data) return { ok: false, error: 'We could not start setup. Please try again.' }
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

const codeSchema = z
  .string()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.')
const uuidSchema = z.uuid()

async function challengeVerify(
  factorId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const who = await loadPrincipal()
  if (!who.authenticated || !who.userId) return { ok: false, error: 'Please sign in first.' }
  const c = codeSchema.safeParse(code)
  const f = uuidSchema.safeParse(factorId)
  if (!c.success || !f.success)
    return { ok: false, error: c.error?.issues[0]?.message ?? 'Invalid request.' }
  // Brute-force protection (GoTrue does not limit wrong TOTP attempts locally).
  if (!(await rateLimit(`mfa:user:${who.userId}`, 300, 6))) {
    await recordSecurityEvent(who.userId, 'mfa.rate_limited')
    return { ok: false, error: TOO_MANY }
  }
  const supabase = await createSupabaseServerClient()
  const ch = await supabase.auth.mfa.challenge({ factorId: f.data })
  if (ch.error || !ch.data)
    return { ok: false, error: 'That authenticator is not available. Try another one.' }
  const v = await supabase.auth.mfa.verify({
    factorId: f.data,
    challengeId: ch.data.id,
    code: c.data,
  })
  if (v.error) {
    await recordSecurityEvent(who.userId, 'mfa.verify_failed')
    return { ok: false, error: 'That code is not correct. Wait for a new code and try again.' }
  }
  return { ok: true }
}

export async function verifyEnrollmentAction(
  factorId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await challengeVerify(factorId, code)
  if (r.ok) await recordSecurityEvent((await loadPrincipal()).userId, 'mfa.enrolled')
  return r
}

export async function verifySignInAction(
  factorId: string,
  code: string,
  next: string,
): Promise<{ ok: false; error: string }> {
  const r = await challengeVerify(factorId, code)
  if (!r.ok) return { ok: false, error: r.error ?? 'Could not verify.' }
  redirect(safeNextPath(next))
}

export async function removeFactorAction(
  factorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { who, decision } = await checkAccess({ aal: 'aal2' })
  if (!decision.allow || !who.userId)
    return { ok: false, error: 'Confirm your authenticator code to continue.' }
  if (!uuidSchema.safeParse(factorId).success) return { ok: false, error: 'Invalid request.' }
  const supabase = await createSupabaseServerClient()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verified = (factors?.totp ?? []).filter((f) => f.status === 'verified')
  if (who.roles.some(isPrivilegedRole) && verified.length <= 1) {
    return {
      ok: false,
      error: 'Your role needs at least one authenticator. Add another before removing this one.',
    }
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: 'We could not remove that authenticator.' }
  await recordSecurityEvent(who.userId, 'mfa.factor_removed')
  return { ok: true }
}

/** The Security page: a signed-in person adds or changes their matric number. */
export async function saveMatricAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const who = await loadPrincipal()
  if (!who.authenticated || !who.userId) return { error: 'Please sign in first.' }
  if (!(await rateLimit(`matric:user:${who.userId}`, 3600, 10))) return { error: TOO_MANY }
  const matric = String(formData.get('matric') ?? '').trim()
  if (!validStudentId(matric))
    return { error: 'Enter your matric number (letters, numbers, / . - _).' }
  const ok = await saveMatricNumber(who.userId, matric)
  return ok
    ? { ok: true, message: 'Your matric number is saved.' }
    : { error: 'Could not save it. Try again.' }
}
