// Pins down the Supabase Auth MFA behavior the app relies on (documented in docs/review-log.md).
// If a Supabase upgrade changes any of this, these tests fail loudly instead of silently weakening MFA.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { admin, createUser, freshCode, PASSWORD, SUPABASE_URL } from './helpers'

const client = () =>
  createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())

async function userWithFactor(label: string) {
  const u = await createUser(label)
  const c = client()
  await c.auth.signInWithPassword({ email: u.email, password: PASSWORD })
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
  const ch = await c.auth.mfa.challenge({ factorId: en.data!.id })
  const v = await c.auth.mfa.verify({
    factorId: en.data!.id,
    challengeId: ch.data!.id,
    code: await freshCode(en.data!.totp.secret),
  })
  expect(v.error).toBeNull()
  return { u, secret: en.data!.totp.secret, factorId: en.data!.id, aal2Client: c }
}

test('aal claim: password login is aal1; after TOTP it is aal2 and survives refresh', async () => {
  const f = await userWithFactor('aal')
  expect(claims((await f.aal2Client.auth.getSession()).data.session!.access_token).aal).toBe('aal2')
  const r = await f.aal2Client.auth.refreshSession()
  expect(claims(r.data.session!.access_token).aal).toBe('aal2')
  const fresh = client()
  const si = await fresh.auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  expect(claims(si.data.session!.access_token).aal).toBe('aal1')
  expect((await fresh.auth.mfa.getAuthenticatorAssuranceLevel()).data).toMatchObject({
    currentLevel: 'aal1',
    nextLevel: 'aal2',
  })
})

test('verifying a first factor revokes the user’s other sessions', async () => {
  const u = await createUser('revoke')
  const a = client()
  await a.auth.signInWithPassword({ email: u.email, password: PASSWORD })
  const b = client()
  await b.auth.signInWithPassword({ email: u.email, password: PASSWORD })
  const bRefresh = (await b.auth.getSession()).data.session!.refresh_token
  const en = await a.auth.mfa.enroll({ factorType: 'totp' })
  const ch = await a.auth.mfa.challenge({ factorId: en.data!.id })
  await a.auth.mfa.verify({
    factorId: en.data!.id,
    challengeId: ch.data!.id,
    code: await freshCode(en.data!.totp.secret),
  })
  const r = await client().auth.refreshSession({ refresh_token: bRefresh })
  expect(r.error).not.toBeNull()
})

test('an aal1 session cannot remove a verified factor, add another factor, or change email/password', async () => {
  const f = await userWithFactor('aal1-guard')
  const c = client()
  await c.auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  expect((await c.auth.mfa.unenroll({ factorId: f.factorId })).error?.message).toMatch(/AAL2/i)
  expect(
    (await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'attacker' })).error?.message,
  ).toMatch(/AAL2/i)
  expect((await c.auth.updateUser({ password: 'Another-Strong-Pass-1' })).error?.message).toMatch(
    /AAL2/i,
  )
  expect((await c.auth.updateUser({ email: `x-${f.u.email}` })).error?.message).toMatch(/AAL2/i)
})

test('a backup factor can be added at aal2 and works alone for sign-in', async () => {
  const f = await userWithFactor('backup')
  const en = await f.aal2Client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Backup authenticator',
  })
  expect(en.error).toBeNull()
  const ch = await f.aal2Client.auth.mfa.challenge({ factorId: en.data!.id })
  expect(
    (
      await f.aal2Client.auth.mfa.verify({
        factorId: en.data!.id,
        challengeId: ch.data!.id,
        code: await freshCode(en.data!.totp.secret),
      })
    ).error,
  ).toBeNull()
  const c = client()
  await c.auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  const ch2 = await c.auth.mfa.challenge({ factorId: en.data!.id })
  const v = await c.auth.mfa.verify({
    factorId: en.data!.id,
    challengeId: ch2.data!.id,
    code: await freshCode(en.data!.totp.secret),
  })
  expect(claims(v.data!.access_token).aal).toBe('aal2')
})

test('removing all factors drops the account to password-only (why lost-factor recovery is an owner decision)', async () => {
  const f = await userWithFactor('dropout')
  expect((await f.aal2Client.auth.mfa.unenroll({ factorId: f.factorId })).error).toBeNull()
  const r = await f.aal2Client.auth.refreshSession()
  expect(claims(r.data.session!.access_token).aal).toBe('aal1')
  const si = await client().auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  expect((await client().auth.mfa.getAuthenticatorAssuranceLevel()).data?.nextLevel ?? 'aal1').toBe(
    'aal1',
  )
  expect(si.error).toBeNull() // no second step is demanded any more
})

test('admin-API factor deletion does NOT revoke other sessions (documented risk for admin-assisted recovery)', async () => {
  const f = await userWithFactor('adminDelete')
  const other = client()
  await other.auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  const rt = (await other.auth.getSession()).data.session!.refresh_token
  expect(
    (await admin().auth.admin.mfa.deleteFactor({ userId: f.u.id, id: f.factorId })).error,
  ).toBeNull()
  const r = await client().auth.refreshSession({ refresh_token: rt })
  expect(r.error).toBeNull() // the aal1 session is still valid
})

test('the experimental recovery-code factor is NOT available on this server (we do not use it)', async () => {
  const f = await userWithFactor('reccodes')
  const token = (await f.aal2Client.auth.getSession()).data.session!.access_token
  const res = await fetch(`${SUPABASE_URL}/auth/v1/factors`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ factor_type: 'recovery_code' }),
  })
  expect(res.status).toBe(400)
})

test('Supabase does not limit wrong TOTP guesses at this layer (our server adds the limit)', async () => {
  const f = await userWithFactor('guesses')
  const c = client()
  await c.auth.signInWithPassword({ email: f.u.email, password: PASSWORD })
  let last: number | undefined
  for (let i = 0; i < 8; i++) {
    const ch = await c.auth.mfa.challenge({ factorId: f.factorId })
    const v = await c.auth.mfa.verify({
      factorId: f.factorId,
      challengeId: ch.data!.id,
      code: '000000',
    })
    last = v.error?.status
  }
  expect(last).toBe(422) // still just "invalid code", not 429
})
