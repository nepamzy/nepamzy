// Local stand-in for Paystack TEST mode (no network, no real money). Mirrors only the pieces the app uses:
//   POST /transaction/initialize   GET /transaction/verify/:reference   and a checkout page with
//   "Simulate successful payment" / "Simulate failed payment" which first POSTs a SIGNED webhook to the app
//   (HMAC-SHA512 of the raw body with the secret), then redirects the browser to the callback URL.
// Usage: PAYSTACK_SECRET_KEY=sk_test_... APP_WEBHOOK_URL=http://127.0.0.1:3000/api/webhooks/paystack node scripts/fake-paystack.mjs
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_PAYSTACK_PORT ?? 3002)
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_local_fake_key_for_dev'
const HOOK = process.env.APP_WEBHOOK_URL ?? 'http://127.0.0.1:3000/api/webhooks/paystack'
const txns = new Map()
const transfers = new Map()
let seq = 4000

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => resolve(b))
  })
const sign = (raw) => createHmac('sha512', SECRET).update(raw).digest('hex')
const authorised = (req) => req.headers.authorization === `Bearer ${SECRET}`

async function sendWebhook(t, event, overrides = {}) {
  const body = JSON.stringify({
    event,
    data: {
      id: t.id,
      reference: t.reference,
      amount: t.amount,
      currency: t.currency,
      status: event === 'charge.success' ? 'success' : 'failed',
      channel: 'card',
      ...overrides,
    },
  })
  await fetch(HOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(body) },
    body,
  })
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (req.method === 'POST' && url.pathname === '/transaction/initialize') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const b = JSON.parse(await readBody(req))
      const t = {
        id: ++seq,
        reference: b.reference,
        amount: b.amount,
        currency: b.currency ?? 'NGN',
        callback: b.callback_url,
        state: 'pending',
        access_code: `ac_${seq}`,
      }
      txns.set(t.reference, t)
      return json(res, 200, {
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: `http://127.0.0.1:${PORT}/checkout/${encodeURIComponent(t.reference)}`,
          access_code: t.access_code,
          reference: t.reference,
        },
      })
    }
    const v = /^\/transaction\/verify\/(.+)$/.exec(url.pathname)
    if (req.method === 'GET' && v) {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const t = txns.get(decodeURIComponent(v[1]))
      if (!t) return json(res, 404, { status: false, message: 'Transaction reference not found' })
      return json(res, 200, {
        status: true,
        message: 'Verification successful',
        data: {
          id: t.id,
          reference: t.reference,
          status: t.state === 'success' ? 'success' : t.state === 'failed' ? 'failed' : 'abandoned',
          amount: t.amount,
          currency: t.currency,
        },
      })
    }
    const c = /^\/checkout\/(.+)$/.exec(url.pathname)
    if (c) {
      const t = txns.get(decodeURIComponent(c[1]))
      if (!t) {
        res.writeHead(404)
        return res.end('unknown reference')
      }
      if (req.method === 'POST') {
        const outcome = new URLSearchParams(await readBody(req)).get('outcome')
        t.state = outcome === 'success' ? 'success' : 'failed'
        await sendWebhook(t, outcome === 'success' ? 'charge.success' : 'charge.failed')
        res.writeHead(303, {
          location: `${t.callback}?reference=${encodeURIComponent(t.reference)}&trxref=${encodeURIComponent(t.reference)}`,
        })
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fake Paystack checkout</title><body style="font-family:sans-serif;padding:24px"><h1>Fake Paystack (test)</h1><p>Reference ${t.reference}</p><p>Amount NGN ${(t.amount / 100).toFixed(2)}</p><form method="post"><button name="outcome" value="success">Simulate successful payment</button> <button name="outcome" value="failed">Simulate failed payment</button></form></body></html>`,
      )
    }
    // ---- transfers (paying shops). FAKE_TRANSFER_MODE: success (default) | pending | failed | otp
    if (req.method === 'POST' && url.pathname === '/transferrecipient') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const b = JSON.parse(await readBody(req))
      return json(res, 200, {
        status: true,
        message: 'Recipient created',
        data: { recipient_code: `RCP_fake${++seq}`, name: b.name, type: 'nuban' },
      })
    }
    if (req.method === 'POST' && url.pathname === '/transfer') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const b = JSON.parse(await readBody(req))
      if (transfers.has(b.reference))
        return json(res, 400, { status: false, message: 'Transfer reference already exists' })
      const mode = process.env.FAKE_TRANSFER_MODE ?? 'success'
      const t = {
        reference: b.reference,
        amount: b.amount,
        transfer_code: `TRF_fake${++seq}`,
        status:
          mode === 'otp'
            ? 'otp'
            : mode === 'pending'
              ? 'pending'
              : mode === 'failed'
                ? 'failed'
                : 'success',
      }
      transfers.set(t.reference, t)
      return json(res, 200, { status: true, message: 'Transfer has been queued', data: t })
    }
    if (req.method === 'POST' && url.pathname === '/transfer/finalize_transfer') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const b = JSON.parse(await readBody(req))
      const t = [...transfers.values()].find((x) => x.transfer_code === b.transfer_code)
      if (!t || b.otp !== '123456') return json(res, 400, { status: false, message: 'Invalid OTP' })
      t.status = 'success'
      return json(res, 200, { status: true, message: 'Transfer has been queued', data: t })
    }
    const tv = /^\/transfer\/verify\/(.+)$/.exec(url.pathname)
    if (req.method === 'GET' && tv) {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const t = transfers.get(decodeURIComponent(tv[1]))
      if (!t) return json(res, 404, { status: false, message: 'Transfer not found' })
      return json(res, 200, { status: true, message: 'Transfer retrieved', data: t })
    }
    if (req.method === 'GET' && url.pathname === '/bank') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      return json(res, 200, {
        status: true,
        data: [
          { name: 'Access Bank', code: '044', active: true },
          { name: 'Guaranty Trust Bank', code: '058', active: true },
          { name: 'Zenith Bank', code: '057', active: true },
        ],
      })
    }
    if (req.method === 'GET' && url.pathname === '/bank/resolve') {
      if (!authorised(req)) return json(res, 401, { status: false, message: 'Invalid key' })
      const number = url.searchParams.get('account_number') ?? ''
      // test rule: numbers ending 0000 do not exist; everything else resolves to a fixed test name
      if (!/^[0-9]{10}$/.test(number) || number.endsWith('0000'))
        return json(res, 422, { status: false, message: 'Could not resolve account name' })
      return json(res, 200, {
        status: true,
        data: { account_number: number, account_name: 'Ada Obi Test Kitchen' },
      })
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true })
    // test hooks: replay / tamper (used by e2e only)
    if (req.method === 'POST' && url.pathname === '/__replay') {
      const { reference, event, amount } = JSON.parse(await readBody(req))
      const t = txns.get(reference)
      if (!t) return json(res, 404, { ok: false })
      await sendWebhook(t, event ?? 'charge.success', amount ? { amount } : {})
      return json(res, 200, { ok: true })
    }
    res.writeHead(404)
    res.end('not found')
  } catch (e) {
    json(res, 500, { status: false, message: String(e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fake paystack listening on ${PORT}`))
