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
