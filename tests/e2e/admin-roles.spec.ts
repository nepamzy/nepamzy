import { expect, test } from '@playwright/test'
import { admin, alertIn, createUser, enrolFactorViaApi, statusIn, uiSignInWithMfa } from './helpers'

test.use({
  extraHTTPHeaders: {
    'x-forwarded-for': `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})

test('platform admin grants and revokes a role through the UI; everything is audited; self-change is refused', async ({
  page,
}) => {
  const a = await createUser('admin-roles', ['platform_admin'])
  const target = await createUser('target')
  const { secret } = await enrolFactorViaApi(a.email)
  await uiSignInWithMfa(page, a.email, secret, '/admin/roles')
  await expect(page).toHaveURL(/\/admin\/roles$/)

  const submit = async (userId: string, role: string, op: 'grant' | 'revoke') => {
    await page.getByLabel('User ID').fill(userId)
    await page.getByLabel('Role').selectOption(role)
    await page.getByLabel('Action').selectOption(op)
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Apply' }).click(),
    ])
  }

  await submit(target.id, 'rider', 'grant')
  await expect(statusIn(page)).toContainText(/granted/i)
  const { data: g } = await admin()
    .from('role_assignments')
    .select('status, granted_by')
    .eq('user_id', target.id)
    .eq('role', 'rider')
  expect(g).toEqual([{ status: 'active', granted_by: a.id }])

  await submit(a.id, 'finance_admin', 'grant')
  await expect(alertIn(page)).toContainText(/cannot change your own roles/i)

  await submit(target.id, 'rider', 'revoke')
  await expect(statusIn(page)).toContainText(/revoked/i)
  const { data: r } = await admin()
    .from('role_assignments')
    .select('status')
    .eq('user_id', target.id)
    .eq('role', 'rider')
  expect(r).toEqual([{ status: 'revoked' }])

  const { data: ev } = await admin().from('audit_events').select('action').eq('actor_id', a.id)
  expect(ev!.map((e) => e.action)).toEqual(expect.arrayContaining(['role.granted', 'role.revoked']))

  // The audit page (real data via RLS) shows the events
  await page.goto('/admin/audit')
  await expect(page.getByText('role.granted').first()).toBeVisible()
})

test('a support agent cannot use the role form even by calling the server action path (page is 403)', async ({
  page,
}) => {
  const s = await createUser('support', ['support_agent'])
  const { secret } = await enrolFactorViaApi(s.email)
  await uiSignInWithMfa(page, s.email, secret)
  expect((await page.goto('/admin/roles'))?.status()).toBe(403)
})

test('server-action replay: a non-admin session cannot change roles even with a valid captured action request', async ({
  browser,
  page,
}) => {
  // 1. Capture a real role-grant request made by a genuine administrator.
  const a = await createUser('admin-capture', ['platform_admin'])
  const target = await createUser('replay-target')
  const { secret } = await enrolFactorViaApi(a.email)
  await uiSignInWithMfa(page, a.email, secret, '/admin/roles')
  const captured = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/admin/roles'),
  )
  await page.getByLabel('User ID').fill(target.id)
  await page.getByLabel('Role').selectOption('rider')
  await page.getByLabel('Action').selectOption('grant')
  await page.getByRole('button', { name: 'Apply' }).click()
  const req = await captured
  const headers = req.headers()
  const body = req.postDataBuffer()!
  await expect(statusIn(page)).toContainText(/granted/i)
  await admin().from('role_assignments').delete().eq('user_id', target.id).eq('role', 'rider') // reset

  // 2. Replay it from sessions that must be refused: a support agent (aal2) and a customer (aal2).
  for (const [label, roles] of [
    ['support', ['support_agent']],
    ['plain', []],
  ] as const) {
    const u = await createUser(`replay-${label}`, [...roles])
    const f = await enrolFactorViaApi(u.email)
    const ctx = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': `10.4.250.${label === 'support' ? 1 : 2}` },
    })
    const p = await ctx.newPage()
    await uiSignInWithMfa(p, u.email, f.secret)
    const res = await ctx.request.post('/admin/roles', {
      headers: {
        'next-action': headers['next-action']!,
        'content-type': headers['content-type']!,
        accept: headers['accept'] ?? 'text/x-component',
        origin: 'http://127.0.0.1:3000',
        'next-router-state-tree': headers['next-router-state-tree'] ?? '',
      },
      data: body,
    })
    const text = await res.text()
    expect(text, `${label}: the action itself must refuse`).toMatch(
      /You are not allowed to do this/,
    )
    expect(text, label).not.toMatch(/Role granted/)
    const { data } = await admin()
      .from('role_assignments')
      .select('role')
      .eq('user_id', target.id)
      .eq('role', 'rider')
    expect(data, `${label} must not have granted a role`).toEqual([])
    await ctx.close()
  }
})
