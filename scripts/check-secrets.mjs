// Fails when a secret-looking value is committed or ends up in the client bundle.
// 1) tracked files: Supabase secret keys, JWT-shaped strings, private keys
// 2) .next/static (everything shipped to browsers): the same patterns, plus the exact values of
//    server-only environment variables (read from the environment / .env.local), plus the
//    variable name SUPABASE_SERVICE_ROLE_KEY itself.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT-shaped token'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'payment provider secret key'],
]
const findings = []

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const f of tracked) {
  if (
    /\.(png|jpg|jpeg|gif|ico|woff2?|lock)$/.test(f) ||
    f === 'pnpm-lock.yaml' ||
    f === 'scripts/check-secrets.mjs'
  )
    continue
  let text
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  for (const [re, name] of PATTERNS) if (re.test(text)) findings.push(`tracked file ${f}: ${name}`)
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
// Exact server-only values
const secrets = []
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(
      /^(SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|PICKUP_CODE_SECRET|JOBS_SECRET|BANK_DATA_KEYS)=(.+)$/,
    )
    if (m?.[2]) {
      if (m[1] === 'BANK_DATA_KEYS')
        // "id:base64,id2:base64": each key value is a secret on its own
        for (const part of m[2].split(',')) secrets.push(part.slice(part.indexOf(':') + 1).trim())
      else secrets.push(m[2].trim())
    }
  }
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY) secrets.push(process.env.SUPABASE_SERVICE_ROLE_KEY)
for (const part of (process.env.BANK_DATA_KEYS ?? '').split(','))
  if (part.includes(':')) secrets.push(part.slice(part.indexOf(':') + 1).trim())

let scanned = 0
if (existsSync('.next/static')) {
  for (const f of walk('.next/static')) {
    if (!/\.(js|css|html|json|map)$/.test(f)) continue
    scanned++
    const text = readFileSync(f, 'utf8')
    for (const s of secrets)
      if (s && text.includes(s))
        findings.push(`client bundle ${f}: contains a server-only secret value`)
    if (text.includes('SUPABASE_SERVICE_ROLE_KEY'))
      findings.push(`client bundle ${f}: references SUPABASE_SERVICE_ROLE_KEY`)
    for (const [re, name] of PATTERNS)
      if (re.test(text)) findings.push(`client bundle ${f}: ${name}`)
  }
} else {
  console.log('note: .next/static not found; run `pnpm build` to also scan the client bundle')
}
if (findings.length) {
  console.error('SECRET SCAN FAILED:\n - ' + findings.join('\n - '))
  process.exit(1)
}
console.log(
  `secret scan ok (${tracked.length} tracked files, ${scanned} client bundle files, ${secrets.length} secret values checked)`,
)
