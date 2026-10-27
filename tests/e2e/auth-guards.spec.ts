import { expect, test } from '@playwright/test'
import {
  admin,
  alertIn,
  createUser,
  enrolFactorViaApi,
  freshCode,
  PASSWORD,
  submitCode,
  uiMfaChallenge,
  uiSignIn,
  uiSignInAttempt,
  uiSignInWithMfa,
  uiSignOut,
} from './helpers'

test.use({
  extraHTTPHeaders: {
    'x-forwarded-for': `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})

const PROTECTED = [
  '/orders',
  '/account',
  '/account/security',
  '/vendor',
  '/vendor/orders',
  '/rider',
  '/admin',
  '/admin/audit',
  '/admin/roles',
  '/mfa/enroll',
]

test.describe('anonymous visitors', () => {
  for (const p of PROTECTED) {
    test(`${p} redirects to sign-in and remembers the destination`, async ({ page }) => {
      await page.goto(p)
      await expect(page).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(p).replace(/%2F/g, '%2F')}`),
      )
    })
  }
})

test.describe('wrong role -> 403', () => {
  const matrix: { role: string; denied: string[]; allowed: string[] }[] = [
    {
      role: 'customer',
      denied: ['/vendor', '/rider', '/admin', '/admin/audit', '/admin/roles'],
      allowed: ['/orders', '/account'],
    },
    // Note: every account also holds the default `customer` role, so /orders is open to all roles (at aal2).
    {
      role: 'vendor_owner',
      denied: ['/rider', '/admin', '/admin/roles'],
      allowed: ['/vendor', '/account', '/orders'],
    },
    { role: 'rider', denied: ['/vendor', '/admin'], allowed: ['/rider', '/orders'] },
    {
      role: 'support_agent',
      denied: ['/admin/roles', '/vendor', '/rider', '/admin/payments', '/admin/riders'],
      allowed: ['/admin', '/admin/audit', '/admin/rider-issues'],
    },
    {
      role: 'finance_admin',
      denied: [
        '/admin/roles',
        '/admin/audit',
        '/admin/applications',
        '/admin/vendors',
        '/admin/riders',
        '/admin/rider-issues',
      ],
      allowed: ['/admin', '/admin/payments'],
    },
    {
      role: 'platform_admin',
      denied: ['/vendor', '/rider'],
      allowed: [
        '/admin',
        '/admin/audit',
        '/admin/roles',
        '/admin/payments',
        '/admin/riders',
        '/admin/rider-issues',
      ],
    },
  ]
  for (const m of matrix) {
    test(`${m.role}: allowed pages open, others return HTTP 403`, async ({ page }) => {
      const u = await createUser(m.role, m.role === 'customer' ? [] : [m.role])
      const { secret } = await enrolFactorViaApi(u.email)
      await uiSignInWithMfa(page, u.email, secret)
      for (const p of m.allowed) expect((await page.goto(p))?.status(), `${m.role} ${p}`).toBe(200)
      for (const p of m.denied) {
        const res = await page.goto(p)
        expect(res?.status(), `${m.role} ${p}`).toBe(403)
        await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()
      }
    })
  }
})

test.describe('MFA is enforced for protected areas', () => {
  test('vendor with a factor but only aal1 is sent to the code page, then allowed after verifying', async ({
    page,
  }) => {
    const u = await createUser('vendor', ['vendor_owner'])
    const { secret } = await enrolFactorViaApi(u.email)
    await uiSignIn(page, u.email)
    await expect(page).toHaveURL(/\/mfa\/challenge/)
    // Still aal1 here: protected pages bounce back to the challenge.
    await page.goto('/vendor')
    await expect(page).toHaveURL(/\/mfa\/challenge\?next=%2Fvendor/)
    await uiMfaChallenge(page, secret)
    await expect(page).toHaveURL(/\/vendor$/)
    // this test account has the vendor role but no shop yet, so the vendor area explains that
    await expect(page.getByRole('heading', { name: 'No vendor account yet' })).toBeVisible()
  })

  test('staff with NO factor must enrol before reaching anything protected', async ({ page }) => {
    const u = await createUser('staff-nofactor', ['support_agent'])
    await uiSignIn(page, u.email)
    await expect(page).toHaveURL(/\/mfa\/enroll/)
    await page.goto('/admin/cases')
    await expect(page).toHaveURL(/\/mfa\/enroll\?next=%2Fadmin%2Fcases/)
  })

  test('a vendor with no authenticator is NOT forced to set one up: two-step sign-in is optional', async ({
    page,
  }) => {
    const u = await createUser('vendor-nofactor', ['vendor_owner'])
    await uiSignIn(page, u.email)
    await expect(page).not.toHaveURL(/\/mfa\//)
    await page.goto('/vendor')
    await expect(page).toHaveURL(/\/vendor$/)
  })

  test('admin at aal1 cannot reach /admin even right after password sign-in', async ({ page }) => {
    const u = await createUser('admin', ['platform_admin'])
    const { secret } = await enrolFactorViaApi(u.email)
    await uiSignIn(page, u.email)
    await page.goto('/admin/roles')
    await expect(page).toHaveURL(/\/mfa\/challenge\?next=%2Fadmin%2Froles/)
    expect(secret).toBeTruthy()
  })

  test('a wrong code is rejected and repeated wrong codes are rate limited', async ({ page }) => {
    const u = await createUser('ratelimit', ['rider'])
    const { secret } = await enrolFactorViaApi(u.email)
    await uiSignIn(page, u.email)
    await expect(page).toHaveURL(/\/mfa\/challenge/)
    for (let i = 0; i < 6; i++) {
      await submitCode(page, '000000', 'Verify')
      await expect(alertIn(page)).toContainText(/not correct/i)
      await expect(page.getByLabel('6-digit code')).toHaveValue('')
    }
    await submitCode(page, '000000', 'Verify')
    await expect(alertIn(page)).toContainText(/too many attempts/i)
    // Even the right code is refused while rate limited.
    await expect(page.getByLabel('6-digit code')).toHaveValue('')
    await submitCode(page, await freshCode(secret), 'Verify')
    await expect(alertIn(page)).toContainText(/too many attempts/i)
    await expect(page).toHaveURL(/\/mfa\/challenge/)
    const { data } = await admin().from('audit_events').select('action').eq('actor_id', u.id)
    expect(data!.map((r) => r.action)).toEqual(
      expect.arrayContaining(['mfa.verify_failed', 'mfa.rate_limited']),
    )
  })
})

test.describe('sign-in safety', () => {
  test('wrong password gives a generic message; repeated failures are rate limited and audited', async ({
    page,
  }) => {
    const u = await createUser('brute')
    await page.goto('/login')
    for (let i = 0; i < 10; i++) {
      await uiSignInAttempt(page, u.email, 'Wrong-Password-1')
      await expect(alertIn(page)).toContainText(/incorrect/i)
      await expect(page.getByLabel('Password')).toHaveValue('')
      await expect(page.getByLabel('Email')).toHaveValue(u.email) // email is kept for convenience
    }
    await uiSignInAttempt(page, u.email, 'Wrong-Password-1')
    await expect(alertIn(page)).toContainText(/too many attempts/i)
    await expect(page.getByLabel('Password')).toHaveValue('')
    // The correct password is also refused while limited.
    await uiSignInAttempt(page, u.email, PASSWORD)
    await expect(alertIn(page)).toContainText(/too many attempts/i)
    await expect(page).toHaveURL(/\/login/)
    const { data } = await admin()
      .from('audit_events')
      .select('action, details')
      .in('action', ['auth.login_failed', 'auth.login_rate_limited'])
    expect(data!.length).toBeGreaterThan(0)
    expect(JSON.stringify(data)).not.toContain(u.email) // only a hash prefix is recorded
  })

  test('open redirects are ignored after sign-in', async ({ page }) => {
    const u = await createUser('redir')
    await uiSignIn(page, u.email, PASSWORD, 'https://evil.example/steal')
    await expect(page).toHaveURL('http://127.0.0.1:3000/')
  })

  test('sign out ends the session', async ({ page }) => {
    const u = await createUser('signout')
    const { secret } = await enrolFactorViaApi(u.email)
    await uiSignInWithMfa(page, u.email, secret, '/orders')
    await expect(page).toHaveURL(/\/orders$/)
    await uiSignOut(page)
    await page.goto('/orders')
    await expect(page).toHaveURL(/\/login/)
  })

  test('the session cookie is HttpOnly and not readable from page scripts', async ({
    page,
    context,
  }) => {
    const u = await createUser('cookie')
    const { secret } = await enrolFactorViaApi(u.email)
    await uiSignInWithMfa(page, u.email, secret)
    const cookies = (await context.cookies()).filter((c) => c.name.startsWith('sb-'))
    expect(cookies.length).toBeGreaterThan(0)
    for (const c of cookies) expect(c.httpOnly, c.name).toBe(true)
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-/)
  })
})
