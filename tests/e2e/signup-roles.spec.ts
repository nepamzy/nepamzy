import { expect, test } from '@playwright/test'
import { idCardJpeg } from '../fixtures/id-card'
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
    const mark = (m: string) => console.log(`[t38 ${choice}] ${new Date().toISOString()} ${m}`)
    page.on('pageerror', (e) => mark(`pageerror ${e.message.slice(0, 200)}`))
    page.on('requestfailed', (r) => mark(`requestfailed ${r.url().slice(0, 120)}`))
    const email = uniqueEmail(`signup-${choice.toLowerCase()}`)
    mark('goto /signup')
    await page.goto('/signup')
    mark('steps 1-2')
    await uiSignUpSteps(page, choice)
    mark('fill details')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByLabel(/I confirm that I am 18/).check()
    mark('submit')
    await page.getByRole('button', { name: 'Create account' }).click()
    mark('submitted, waiting for the done screen')
    await expect(page.getByTestId('signup-done')).toBeVisible()
    mark('done screen')
    if (expected) await expect(page.getByText(new RegExp(`${expected} application`))).toBeVisible()
    mark('look up user')
    const id = await userIdByEmail(email)
    mark('get user via admin api')
    const { data: found } = await admin().auth.admin.getUserById(id)
    mark('check roles')
    expect(found.user?.user_metadata?.intended_role).toBe(expected)
    // the choice grants nothing: no role beyond the customer role exists for this account
    const { data: roles } = await admin().from('role_assignments').select('role').eq('user_id', id)
    expect((roles ?? []).map((r) => r.role).filter((r) => r !== 'customer')).toEqual([])
    mark('close')
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

test('a student signs up with a matric number only; the card photo is optional; the account keeps the number', async ({
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
  // Next stays off until a matric number is typed; no photo is needed
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await expect(page.getByText(/ID card number/i)).toHaveCount(0)
  await expect(page.getByText('Photo of your student ID card (optional)')).toBeVisible()
  await page.getByLabel('Matric number').fill('AFIT/2026/0417')
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
  expect(ident.id_card_jpeg).toBeNull()
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
    await expect(page.getByLabel('Matric number')).toHaveCount(0)
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

test('a signed-in person can add and change their matric number under Security', async ({
  browser,
}, info) => {
  const u = await createUser('matric')
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  await uiSignIn(page, u.email, PASSWORD, '/account/security')
  await page.getByLabel('Matric number').fill('AFIT/2026/0999')
  await page.getByRole('button', { name: 'Save matric number' }).click()
  await expect(page.getByText('Your matric number is saved.')).toBeVisible()
  const row = (
    await admin()
      .from('account_identity')
      .select('person_type, student_id_cipher')
      .eq('user_id', u.id)
      .single()
  ).data!
  expect(row.person_type).toBe('student')
  expect(row.student_id_cipher).not.toContain('0999')
  await page.reload()
  await expect(page.getByLabel('Matric number')).toHaveValue('AFIT/2026/0999')
  await context.close()
})

test('a new rider must give a matric number, a phone number and the front and back of the new ID card; a front with no QR code is refused', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? undefined,
    extraHTTPHeaders: { 'x-forwarded-for': randIp() },
  })
  const page = await context.newPage()
  const email = uniqueEmail('signup-rider-id')
  await page.goto('/signup')
  await page
    .getByRole('group', { name: 'I want to use AFIT Market as a' })
    .getByRole('radio', { name: /Rider/ })
    .check()

  // nothing given yet: no way forward
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByLabel('Matric number').fill('AFIT/2026/0777')
  await page.getByLabel('Phone number').fill('12345')
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByLabel('Phone number').fill('0803 123 4567')

  // the OLD card (no QR code on the front) is refused with a clear reason
  await page.locator('#rider-id-front').setInputFiles({
    name: 'old-front.jpg',
    mimeType: 'image/jpeg',
    buffer: await idCardJpeg('front-no-qr'),
  })
  await expect(page.getByText(/cannot see a QR code on the front/i)).toBeVisible()
  await page.locator('#rider-id-back').setInputFiles({
    name: 'back.jpg',
    mimeType: 'image/jpeg',
    buffer: await idCardJpeg('back'),
  })
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()

  // the new card (QR code on the front) is accepted
  await page.locator('#rider-id-front').setInputFiles({
    name: 'front.jpg',
    mimeType: 'image/jpeg',
    buffer: await idCardJpeg('front-with-qr'),
  })
  await expect(page.getByText('QR code found on the front of your card.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  await page.getByRole('button', { name: 'Next' }).click()
  await drawSignature(page)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByLabel(/I confirm that I am 18/).check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('signup-done')).toBeVisible()

  // kept privately: the number and phone are encrypted, both photos are stored, and the QR check is recorded
  const id = await userIdByEmail(email)
  const row = (
    await admin()
      .from('rider_identity')
      .select('matric_cipher, phone_cipher, id_front_jpeg, id_back_jpeg, qr_found')
      .eq('user_id', id)
      .single()
  ).data!
  expect(row.qr_found).toBe(true)
  expect(row.id_front_jpeg).toBeTruthy()
  expect(row.id_back_jpeg).toBeTruthy()
  expect(row.matric_cipher).not.toContain('0777')
  expect(row.phone_cipher).not.toContain('8031234567')
  await context.close()
})
