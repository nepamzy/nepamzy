import { expect, test } from '@playwright/test'
import { pool } from '../db/helpers'
import { paidOrder } from '../db/refund-helpers'
// the repository's own copy of the cipher (the app's module is server-only); the app can read what it writes
const { encrypt: encryptField } = (await import('../../scripts/lib/bank-crypto.mjs')) as {
  encrypt: (s: string) => string
}

// Needs the local database, the app and the fake Paystack (see playwright.config.ts). Nothing here touches the real Paystack.
try {
  process.loadEnvFile('.env.local')
} catch {
  /* the variables may already be set */
}

test.afterAll(async () => {
  await pool.end()
})

test('a completed order is paid to the shop automatically after 24 hours, once, and the shop sees it', async ({
  request,
}) => {
  // a shop with a verified bank account and one completed order
  const c = await pool.connect()
  let order: string
  let vendor: string
  try {
    await c.query('begin')
    const o = await paidOrder(c, { status: 'PICKUP_AWAITING_HANDOVER' })
    order = o.order
    vendor = o.vendor
    await c.query(
      `insert into public.vendor_bank_accounts (vendor_id, bank_code, bank_name, account_name, account_cipher, account_last4)
       values ($1, '058', 'Guaranty Trust Bank', 'MAMA PUT KITCHEN', $2, '6789')`,
      [vendor, encryptField('0123456789')],
    )
    await c.query(
      `insert into public.order_status_history (order_id, from_status, to_status, reason) values ($1, 'PICKUP_AWAITING_HANDOVER', 'COMPLETED', 'e2e')`,
      [order],
    )
    await c.query('commit')
  } finally {
    c.release()
  }
  const secret = process.env.JOBS_SECRET!
  const run = () =>
    request.post('/api/jobs/release-payouts', { headers: { authorization: `Bearer ${secret}` } })

  // nobody else may start it
  expect((await request.post('/api/jobs/release-payouts')).status()).toBe(401)
  expect(
    (
      await request.post('/api/jobs/run-all', { headers: { authorization: 'Bearer nope' } })
    ).status(),
  ).toBe(401)

  // too early: the customer still has time to report a problem, so nothing is paid
  const early = await run()
  expect(early.ok()).toBe(true)
  const before = (
    await pool.query(`select status, amount_kobo from public.vendor_payouts where order_id = $1`, [
      order,
    ])
  ).rows[0]
  expect(before.status).toBe('scheduled')
  expect(before.amount_kobo).toBeNull()

  // 24 hours later
  await pool.query(
    `update public.vendor_payouts set eligible_at = now() - interval '1 minute' where order_id = $1`,
    [order],
  )
  const res = await run()
  expect(res.ok()).toBe(true)
  const row = (await pool.query(`select * from public.vendor_payouts where order_id = $1`, [order]))
    .rows[0]
  expect(row.status).toBe('paid')
  expect(row.transfer_code).toMatch(/^TRF_fake/)
  const line = (
    await pool.query(
      `select base_kobo, commission_kobo from public.order_settlement_lines where order_id = $1`,
      [order],
    )
  ).rows[0]
  expect(Number(row.amount_kobo)).toBe(Number(line.base_kobo) - Number(line.commission_kobo))
  const rec = (
    await pool.query(
      `select paystack_recipient_code from public.vendor_bank_accounts where vendor_id = $1`,
      [vendor],
    )
  ).rows[0]
  expect(rec.paystack_recipient_code).toMatch(/^RCP_/)

  // running it again never pays twice
  await run()
  const after = (
    await pool.query(
      `select count(*)::int n from public.vendor_payouts where order_id = $1 and status = 'paid'`,
      [order],
    )
  ).rows[0]
  expect(after.n).toBe(1)
  // the run is on record for the monitor
  const job = (
    await pool.query(
      `select ok from public.job_runs where job = 'release-payouts' order by id desc limit 1`,
    )
  ).rows[0]
  expect(job.ok).toBe(true)
  // the daily scheduler (a GET from the hosting platform) is accepted, an ordinary GET is not
  expect(
    (
      await request.get('/api/jobs/release-payouts', {
        headers: { 'user-agent': 'vercel-cron/1.0' },
      })
    ).ok(),
  ).toBe(true)
  expect((await request.get('/api/jobs/release-payouts')).status()).toBe(401)
})
