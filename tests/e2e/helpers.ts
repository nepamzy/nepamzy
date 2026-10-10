import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import * as OTPAuth from 'otpauth'
import { expect, type Page } from '@playwright/test'

// Load .env.local (local-stack values) for the test process.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!
  }
}
export const SUPABASE_URL = process.env.SUPABASE_URL!
export const MAIL_SINK = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:54326'
export const PASSWORD = 'Correct-Horse-9-Battery'

export const admin = () =>
  createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })

export const totp = (secret: string) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate()

/** Wait for the next TOTP window if we are in the last 2 seconds of the current one. */
export async function freshCode(secret: string) {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30)
  if (remaining <= 2) await new Promise((r) => setTimeout(r, (remaining + 1) * 1000))
  return totp(secret)
}

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`

export async function createUser(label: string, roles: string[] = []) {
  const email = uniqueEmail(label)
  const a = admin()
  const { data, error } = await a.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  for (const role of roles) {
    const { error: e } = await a.from('role_assignments').insert({ user_id: data.user.id, role })
    if (e) throw e
  }
  return { id: data.user.id, email }
}

/** Enrol a TOTP factor through the Auth API (test setup only) and return its secret. */
export async function enrolFactorViaApi(email: string, friendlyName = 'Authenticator app') {
  const c = createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const si = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (si.error) throw si.error
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName })
  if (en.error || !en.data) throw en.error ?? new Error('enroll failed')
  const ch = await c.auth.mfa.challenge({ factorId: en.data.id })
  if (ch.error) throw ch.error
  const v = await c.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: await freshCode(en.data.totp.secret) })
  if (v.error) throw v.error
  return { secret: en.data.totp.secret, factorId: en.data.id }
}

/** Fill and submit the sign-in form WITHOUT assuming success (use for failure-path tests). */
export async function uiSignInAttempt(page: Page, email: string, password = PASSWORD, next?: string) {
  if (!page.url().includes('/login')) await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

/** Sign in and wait until the server action has finished and redirected away from /login. */
export async function uiSignIn(page: Page, email: string, password = PASSWORD, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

/** Submit a 6-digit code on a challenge/enrol form and wait for the server action + form reset. */
export async function submitCode(page: Page, code: string, button: string | RegExp) {
  const input = page.getByLabel('6-digit code')
  await input.fill(code)
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST'),
    page.getByRole('button', { name: button }).click(),
  ])
}

export const statusIn = (page: Page) => page.locator('main [role="status"]').first()

export async function uiMfaChallenge(page: Page, secret: string) {
  await expect(page).toHaveURL(/\/mfa\/challenge/)
  await page.getByLabel('6-digit code').fill(await freshCode(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  // Wait for the server action to finish (it sets the upgraded session cookie) before navigating on.
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa/challenge'))
}

/** Page-level alert (excludes Next's hidden route announcer, which also has role=alert). */
export const alertIn = (page: Page) => page.locator('main [role="alert"]').first()

export async function uiSignOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('http://127.0.0.1:3000/')
}

/** Sign in through the UI and complete the MFA challenge. */
export async function uiSignInWithMfa(page: Page, email: string, secret: string, next?: string) {
  await uiSignIn(page, email, PASSWORD, next)
  await uiMfaChallenge(page, secret)
}
