// Creates SYNTHETIC local accounts for manual testing against the LOCAL stack only.
// Passwords are random and printed once; nothing is stored in the repository.
// Usage: node --env-file=.env.local scripts/seed-local-users.mjs
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error('Refusing to run: SUPABASE_URL must point to the LOCAL stack.')
  process.exit(1)
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const accounts = [
  ['customer', null], ['vendor', 'vendor_owner'], ['rider', 'rider'],
  ['support', 'support_agent'], ['finance', 'finance_admin'], ['admin', 'platform_admin'],
]
for (const [name, role] of accounts) {
  const email = `${name}@seed.afit-market.test`
  const password = randomBytes(12).toString('base64url') + 'aZ9'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) { console.log(`${email}: ${error.message}`); continue }
  if (role) await admin.from('role_assignments').insert({ user_id: data.user.id, role })
  console.log(`${email}  password: ${password}  role: ${role ?? 'customer'}`)
}
console.log('Each account must enrol an authenticator app at first sign-in to reach protected areas.')
