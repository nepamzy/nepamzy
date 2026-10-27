'use server'

import { notifyWelcome } from '@/server/modules/engagement/dispatch'
import { notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { serverEnv } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkAccess, loadPrincipal } from './guard'
import { isPrivilegedRole, safeNextPath, signUpOutcome } from './policy'
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
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }
  const { email, password } = parsed.data
  const ip = await clientIp()
  if (
    !(await rateLimit(`signup:ip:${ip}`, 3600, 10)) ||
    !(await rateLimit(`signup:email:${sha256Hex(email)}`, 3600, 3))
  ) {
    return { error: TOO_MANY }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${serverEnv().SITE_URL}/auth/confirm`,
      data: { adult_declared: true },
    },
  })
  if (error && error.status && error.status < 500 && error.code !== 'weak_password') {
    logger.warn('signup rejected', { code: error.code })
  }
  const outcome = signUpOutcome({ error, hasSession: Boolean(data?.session) })
  if (outcome === 'weak_password') return { error: 'Choose a stronger password.' }
  if (outcome === 'unavailable')
    return { error: 'We could not create your account right now. Please try again.' }
  if (outcome === 'exists')
    return { error: 'An account with this email already exists. Try signing in instead.', email }
  if (!error) notifyAdmin({ type: 'signup', email })
  // E-mail confirmation is switched off in the provider settings: the person is already signed in.
  if (outcome === 'signed_in') {
    notifyWelcome(email)
    redirect('/')
  }
  // Same message whether or not the address already exists (prevents account enumeration).
  return { ok: true, message: 'Check your email. We sent a link to confirm your address.' }
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
      return { error: 'Please confirm your email first. Check your inbox for our message.', email }
    }
    await recordSecurityEvent(null, 'auth.login_failed', { email_hash: emailKey.slice(0, 16) })
    return { error: 'Email or password is incorrect.', email }
  }
  const who = await loadPrincipal()
  const privileged = who.roles.some(isPrivilegedRole)
  if (who.hasVerifiedFactor) redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`)
  if (privileged) redirect(`/mfa/enroll?next=${encodeURIComponent(next)}`)
  redirect(next)
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
