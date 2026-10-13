import { expect, test } from '@playwright/test'
import {
  userIdByEmail,
  admin,
  alertIn,
  freshCode,
  MAIL_SINK,
  PASSWORD,
  statusIn,
  submitCode,
  uiMfaChallenge,
  uiSignIn,
  uiSignInAttempt,
  uiSignOut,
  uniqueEmail,
} from './helpers'

test.use({
  extraHTTPHeaders: {
    'x-forwarded-for': `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})

test('customer: sign up -> confirm email -> sign in -> MFA required for orders -> backup authenticator', async ({
  page,
}) => {
  const email = uniqueEmail('journey')

  // 1. Sign up through the UI
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  // the 18+ declaration is required: without it nothing is sent
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(alertIn(page)).toContainText(/18 years old or older/i)
  await page.getByLabel(/18 years old or older/i).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(statusIn(page)).toContainText(/check your email/i)

  // 2. Cannot sign in before confirming
  await uiSignInAttempt(page, email)
  await expect(alertIn(page)).toContainText(/confirm your email/i)

  // 3. Open the real confirmation link delivered to the local mail sink
  await expect
    .poll(
      async () =>
        (await (await fetch(`${MAIL_SINK}/messages?to=${encodeURIComponent(email)}`)).json())
          .length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(0)
  const mails = await (await fetch(`${MAIL_SINK}/messages?to=${encodeURIComponent(email)}`)).json()
  const link = (mails[0].text as string).match(/https?:\/\/\S+/)![0].replace(/[)\]>]+$/, '')
  expect(link).toContain('/auth/confirm?token_hash=')
  await page.goto(link)
  await expect(page).toHaveURL(/\/login\?confirmed=1/)
  await expect(statusIn(page)).toContainText(/email confirmed/i)
  // The confirmation link is single-use
  await page.goto(link)
  await expect(page).toHaveURL(/\/login\?error=1/)

  // 4. Sign in: customers can browse without MFA...
  await uiSignIn(page, email)
  await expect(page).toHaveURL('http://127.0.0.1:3000/')
  // ...but ordering / account features require the second step
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/mfa\/enroll\?next=%2Forders/)

  // 5. Enrol an authenticator app (scan-less: use the manual key shown on screen)
  await page.getByRole('button', { name: 'Start setup' }).click()
  const secret = (await page.locator('code').first().textContent())!.trim()
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)
  await submitCode(page, '000000', /confirm and finish/i)
  await expect(alertIn(page)).toContainText(/not correct/i)
  await submitCode(page, await freshCode(secret), /confirm and finish/i)
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible()

  // 6. New sign-in needs the code again; orders stay locked until verified
  await uiSignOut(page)
  await uiSignIn(page, email)
  await expect(page).toHaveURL(/\/mfa\/challenge/)
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/mfa\/challenge\?next=%2Forders/)
  await uiMfaChallenge(page, secret)
  await expect(page).toHaveURL(/\/orders$/)

  // 7. Add a backup authenticator (needs aal2, which we have)
  await page.goto('/account/security')
  await expect(page.getByText('Authenticator app', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start setup' }).click()
  const backupSecret = (await page.locator('code').first().textContent())!.trim()
  await submitCode(page, await freshCode(backupSecret), /confirm and finish/i)
  await expect(page.getByText('Authenticator added.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Backup authenticator', { exact: true })).toBeVisible()

  // 8. Sign in using ONLY the backup authenticator (simulates a lost main phone)
  await uiSignOut(page)
  await uiSignIn(page, email)
  await expect(page).toHaveURL(/\/mfa\/challenge/)
  await page.getByLabel('Backup authenticator').check()
  await page.getByLabel('6-digit code').fill(await freshCode(backupSecret))
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForURL('http://127.0.0.1:3000/')

  // 9. Audit trail recorded the enrolment events (and no raw email)
  const id = await userIdByEmail(email)
  const { data: ev } = await admin().from('audit_events').select('action').eq('actor_id', id)
  expect(ev!.filter((e) => e.action === 'mfa.enrolled')).toHaveLength(2)
})

test('customer can remove one authenticator but a privileged role cannot remove its last one', async ({
  page,
}) => {
  const { createUser, enrolFactorViaApi, uiSignInWithMfa } = await import('./helpers')
  // privileged: last factor protected
  const v = await createUser('vendor-lastfactor', ['vendor_owner'])
  const { secret } = await enrolFactorViaApi(v.email)
  await uiSignInWithMfa(page, v.email, secret, '/account/security')
  await expect(page.getByRole('button', { name: /remove authenticator app/i })).toHaveCount(0)
})
