import { expect, test } from '@playwright/test'
import {
  PASSWORD,
  admin,
  createUser,
  enrolFactorViaApi,
  randIp,
  uiMfaChallenge,
  uiSignIn,
  uniqueEmail,
  userIdByEmail,
  drawSignature,
  uiSignUpSteps,
} from './helpers'

/**
 * Sign-up asks what the person wants to be (customer, vendor, rider) and routes vendors and riders to their application.
 * The choice never grants a role. The administrator option is not offered on the public pages; the administrator enters through
 * a hidden page reached by tapping the logo three times on the home page.
 */
test.describe.configure({ mode: 'serial' })

test('the public pages never mention the administrator, and sign-up offers customer, vendor and rider', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('Administrator')).toHaveCount(0)
  await expect(page.getByLabel('Administrator')).toHaveCount(0)
  await page.goto('/signup')
  await expect(page.getByText('Administrator')).toHaveCount(0)
  const group = page.getByRole('group', { name: 'I want to use AFIT Market as a' })
  await expect(group.getByRole('radio', { name: /Customer/ })).toBeChecked()
  await expect(group.getByRole('radio', { name: /Vendor/ })).not.toBeChecked()
  await expect(group.getByRole('radio', { name: /Rider/ })).not.toBeChecked()
})

test('signing up as a vendor or rider records the choice; a customer sign-up records none', async ({
  browser,
}, info) => {
  for (const [choice, expected] of [
    ['Vendor', 'vendor'],
    ['Rider', 'rider'],
    ['Customer', undefined],
  ] as const) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    const email = uniqueEmail(`signup-${choice.toLowerCase()}`)
    await page.goto('/signup')
    await uiSignUpSteps(page, choice)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByLabel(/I confirm that I am 18/).check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('signup-done')).toBeVisible()
    if (expected) await expect(page.getByText(new RegExp(`${expected} application`))).toBeVisible()
    const id = await userIdByEmail(email)
    const { data: found } = await admin().auth.admin.getUserById(id)
    expect(found.user?.user_metadata?.intended_role).toBe(expected)
    // the choice grants nothing: no role beyond the customer role exists for this account
    const { data: roles } = await admin().from('role_assignments').select('role').eq('user_id', id)
    expect((roles ?? []).map((r) => r.role).filter((r) => r !== 'customer')).toEqual([])
    await context.close()
  }
})

test('after signing in, someone who chose vendor or rider lands on that application, and an ordinary customer on the home page', async ({
  browser,
}, info) => {
  for (const [intent, path] of [
    ['vendor', /\/apply$/],
    ['rider', /\/rider-apply$/],
    [undefined, /^http:\/\/127\.0\.0\.1:3000\/$/],
  ] as const) {
    const u = await createUser(`intent-${intent ?? 'customer'}`)
    if (intent)
      await admin().auth.admin.updateUserById(u.id, { user_metadata: { intended_role: intent } })
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    await uiSignIn(page, u.email)
    await expect(page).toHaveURL(path)
    await context.close()
  }
})

test('three quick taps on the logo on the home page open the administrator sign-in; one tap does not; a non-administrator gets nothing extra', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await page.goto('/')
  // taps only count once the page has started its scripts; before that the logo is a plain link home
  await page.waitForLoadState('networkidle')
  const logo = page.getByRole('link', { name: 'AFIT Market home' }).first()
  await logo.click()
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/)
  // the single tap above must not count towards the three (taps only count within a second of each other)
  await page.waitForTimeout(1100)
  await logo.click({ clickCount: 3, delay: 60 })
  await expect(page).toHaveURL(/\/staff-login$/)
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible()

  // an ordinary customer who finds this page is signed in as a customer: it opens nothing
  const customer = await createUser('staff-door-customer')
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/staff-login'))
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(403)
  await context.close()

  // an administrator signs in there and lands in the administrator interface
  const adm = await createUser('staff-door-admin', ['platform_admin'])
  const { secret } = await enrolFactorViaApi(adm.email)
  const ctx2 = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const p2 = await ctx2.newPage()
  await p2.goto('/staff-login')
  await p2.getByLabel('Email').fill(adm.email)
  await p2.getByLabel('Password').fill(PASSWORD)
  await p2.getByRole('button', { name: 'Sign in' }).click()
  await uiMfaChallenge(p2, secret)
  await expect(p2).toHaveURL(/\/admin$/)
  await ctx2.close()
})

test('the authenticator is optional for customers, vendors and riders: no setup screen is forced on them', async ({
  browser,
  page,
}, info) => {
  await page.goto('/signup')
  await uiSignUpSteps(page)
  await expect(page.getByText(/authenticator app for extra security is optional/i)).toBeVisible()
  await expect(page.getByText(/before you can place orders/i)).toHaveCount(0)
  for (const [role, area] of [
    ['vendor_owner', '/vendor'],
    ['rider', '/rider'],
    [undefined, '/orders'],
  ] as const) {
    const u = await createUser(`optional-mfa-${role ?? 'customer'}`, role ? [role] : [])
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const p = await context.newPage()
    await uiSignIn(p, u.email)
    expect(p.url(), `${role ?? 'customer'} after sign-in`).not.toMatch(/\/mfa\//)
    const res = await p.goto(area)
    expect(res?.status(), `${role ?? 'customer'} on ${area}`).toBe(200)
    expect(p.url(), `${role ?? 'customer'} on ${area}`).not.toMatch(/\/mfa\//)
    await context.close()
  }
})

test('after sign-up there is always a way forward: resend the link, sign in, or start again', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  const email = uniqueEmail('signup-next')
  await page.goto('/signup')
  await uiSignUpSteps(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByLabel(/I confirm that I am 18/).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  const done = page.getByTestId('signup-done')
  await expect(done.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await expect(done.getByText(email, { exact: false }).first()).toBeVisible()
  await expect(done.getByText(/Spam/)).toBeVisible()
  // ask for a new code: the answer is a plain confirmation, not an error
  await done.getByRole('button', { name: 'Send me a new code' }).click()
  await expect(done.getByText(/fresh code/)).toBeVisible()
  // asking again straight away is politely refused, never a crash
  await done.getByRole('button', { name: 'Send me a new code' }).click()
  await expect(done.getByText(/wait a few minutes/)).toBeVisible()
  // the way back to sign-in is always there
  await expect(done.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
    'href',
    '/login',
  )
  await done.getByRole('link', { name: 'Use a different email' }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByTestId('signup-step')).toContainText('Step 1 of 3')
  await context.close()
})

/** A real, readable JPEG made in the browser (the form shrinks the photo, so it has to decode as an image). */
const idCardJpeg = async (page: import('@playwright/test').Page) => {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 900
    c.height = 560
    const g = c.getContext('2d')!
    g.fillStyle = '#f5f0e0'
    g.fillRect(0, 0, 900, 560)
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgb(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255})`
      g.fillRect((i * 83) % 880, (i * 47) % 540, 40, 14)
    }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]!
  })
  return Buffer.from(b64, 'base64')
}

test('a student gives an ID number and card photo, sees that it will be reviewed, can edit it, and the account keeps both', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  const email = uniqueEmail('signup-student')
  await page.goto('/signup')
  await page.getByRole('radio', { name: 'Student', exact: true }).check()
  // Next stays off until the ID card is saved; nothing says the card cannot be checked
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await expect(page.getByText(/cannot be checked|not verified|unverified/i)).toHaveCount(0)
  await page.getByLabel('Student ID card number').fill('AFIT/2026/0417')
  await page.locator('#idcard-file').setInputFiles({
    name: 'id.jpg',
    mimeType: 'image/jpeg',
    buffer: await idCardJpeg(page),
  })
  await page.getByRole('button', { name: 'Save ID card' }).click()
  await expect(page.getByText('Your ID card will be reviewed.')).toBeVisible()
  // editing is possible, and saving again brings the same message back
  await page.getByRole('button', { name: 'Edit ID card' }).click()
  await expect(page.getByLabel('Student ID card number')).toHaveValue('AFIT/2026/0417')
  await page.getByRole('button', { name: 'Save ID card' }).click()
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByRole('button', { name: 'Next' }).click()
  // the signature step carries the statement
  await expect(page.getByText('receive deliveries', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await drawSignature(page)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByLabel(/I confirm that I am 18/).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('signup-done')).toBeVisible()
  const id = await userIdByEmail(email)
  const ident = (
    await admin()
      .from('account_identity')
      .select('person_type, student_id_cipher, id_card_jpeg')
      .eq('user_id', id)
      .single()
  ).data!
  expect(ident.person_type).toBe('student')
  expect(ident.id_card_jpeg).toBeTruthy()
  // the number is stored encrypted, never as typed
  expect(ident.student_id_cipher).not.toContain('2026')
  const sig = await admin().from('user_signatures').select('user_id').eq('user_id', id)
  expect(sig.data).toHaveLength(1)
  await context.close()
})

test('military, lecturer and other customers need no ID card, vendors and riders are not asked who they are, and everyone signs', async ({
  browser,
}, info) => {
  for (const [kind, type] of [
    ['Military', 'military'],
    ['Lecturer', 'lecturer'],
    ['Other', 'other'],
  ] as const) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? undefined,
      extraHTTPHeaders: { 'x-forwarded-for': randIp() },
    })
    const page = await context.newPage()
    const email = uniqueEmail(`signup-${type}`)
    await page.goto('/signup')
    await page.getByRole('radio', { name: kind, exact: true }).check()
    await expect(page.getByLabel('Student ID card number')).toHaveCount(0)
    await page.getByRole('button', { name: 'Next' }).click()
    await drawSignature(page)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByLabel(/I confirm that I am 18/).check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByTestId('signup-done')).toBeVisible()
    const id = await userIdByEmail(email)
    const ident = (
      await admin()
        .from('account_identity')
        .select('person_type, id_card_jpeg')
        .eq('user_id', id)
        .single()
    ).data!
    expect(ident).toMatchObject({ person_type: type, id_card_jpeg: null })
    await context.close()
  }
  // a vendor is not asked "who are you": straight to the signature
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await page.goto('/signup')
  await page.getByRole('radio', { name: /Vendor/ }).check()
  await expect(page.getByRole('radio', { name: 'Student', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await context.close()
})

test('an account with no saved signature is asked for one right after signing in, once, and then goes where it was going', async ({
  page,
}) => {
  const u = await createUser('nosig', [], { signature: false })
  await uiSignIn(page, u.email)
  await expect(page).toHaveURL(/\/signature-setup/)
  await expect(page.getByText('receive deliveries', { exact: true })).toBeVisible()
  await drawSignature(page)
  await page.getByRole('button', { name: 'Save my signature' }).click()
  await expect(page).not.toHaveURL(/signature-setup/)
  const saved = await admin().from('user_signatures').select('user_id').eq('user_id', u.id)
  expect(saved.data).toHaveLength(1)
  // signing in again does not ask again
  await page.context().clearCookies()
  await uiSignIn(page, u.email)
  await expect(page).not.toHaveURL(/signature-setup/)
})
