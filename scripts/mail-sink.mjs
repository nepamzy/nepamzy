// Local-only SMTP sink for development/tests. Receives mail from the local Supabase Auth container
// and exposes it over HTTP so tests can read confirmation links. Nothing is ever sent to the internet.
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import http from 'node:http'

const SMTP_PORT = Number(process.env.MAIL_SINK_SMTP_PORT ?? 54325)
const HTTP_PORT = Number(process.env.MAIL_SINK_HTTP_PORT ?? 54326)
const messages = []

const smtp = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  onAuth(_auth, _session, cb) {
    cb(null, { user: 'local-sink' })
  },
  disabledCommands: ['STARTTLS'],
  onData(stream, _session, cb) {
    simpleParser(stream)
      .then((m) => {
        messages.push({
          to: (m.to?.value ?? []).map((a) => a.address),
          subject: m.subject,
          text: m.text,
          html: m.html || '',
          at: new Date().toISOString(),
        })
        cb()
      })
      .catch(cb)
  },
})
smtp.listen(SMTP_PORT, '0.0.0.0')

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/messages') {
      const to = u.searchParams.get('to')
      const out = to ? messages.filter((m) => m.to.includes(to)) : messages
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(out))
    }
    if (u.pathname === '/clear') {
      messages.length = 0
      return res.end('ok')
    }
    res.statusCode = 404
    res.end()
  })
  .listen(HTTP_PORT, '127.0.0.1')
console.log(`mail sink: smtp :${SMTP_PORT}, http :${HTTP_PORT}`)
