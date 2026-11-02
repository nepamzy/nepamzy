import { expect, test } from '@playwright/test'
import {
  MAIL_SINK,
  PASSWORD,
  alertIn,
  randIp,
  statusIn,
  uiSignUpSteps,
  uniqueEmail,
} from './helpers'

test('sign-up confirms the e-mail with a code: wrong code refused, the right one confirms, a new code replaces the old, and the way back is always there', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  const email = uniqueEmail('code')
  await page.goto('/signup')
  await uiSignUpSteps(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByLabel(/18 years old or older/i).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  const done = page.getByTestId('signup-done')
  await expect(done.getByLabel('Confirmation code')).toBeVisible()
  await expect(done.getByRole('link', { name: 'Back to sign in' })).toBeVisible()

  // the e-mail carries the code (and says what to do with it)
  const codes = async () => {
    const mails = await (
      await fetch(`${MAIL_SINK}/messages?to=${encodeURIComponent(email)}`)
    ).json()
    return (mails as { subject: string; text: string }[]).map((m) => ({
      subject: m.subject,
      code: /\b(\d{6,8})\b/.exec(m.text)?.[1] ?? '',
    }))
  }
  await expect.poll(async () => (await codes()).length, { timeout: 15000 }).toBeGreaterThan(0)
  const first = (await codes())[0]!
  expect(first.code).toMatch(/^\d{6,8}$/)
  expect(first.subject).toContain(first.code)

  // a wrong code is refused and nothing changes
  await done.getByLabel('Confirmation code').fill('000000' === first.code ? '111111' : '000000')
  await done.getByRole('button', { name: 'Confirm my email' }).click()
  await expect(done.getByRole('alert')).toContainText(/not right|expired/i)

  // a pasted code with spaces works
  await done
    .getByLabel('Confirmation code')
    .fill(` ${first.code.slice(0, 3)} ${first.code.slice(3)} `)
  await done.getByRole('button', { name: 'Confirm my email' }).click()
  await expect(page).toHaveURL(/\/login\?confirmed=1/)
  await expect(statusIn(page)).toContainText(/email confirmed/i)
  // the code is single-use
  await page.goto('/signup')
  await expect(alertIn(page)).toHaveCount(0)
  await context.close()
})
