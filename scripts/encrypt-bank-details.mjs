// Encrypts legacy plaintext bank account numbers in place, and re-encrypts rows made with an older key (rotation).
//   node --env-file=.env.local scripts/encrypt-bank-details.mjs [--dry-run] [--rotate]
// Uses the service-role key and BANK_DATA_KEYS / BANK_DATA_KEY_ID (see .env.example). Prints COUNTS ONLY: it never prints an
// account number, a cipher string or a key. Safe to re-run (idempotent). Nothing is deleted unless the encrypted copy was
// written first: a row's plaintext is cleared in the same UPDATE that stores its cipher.
import { createClient } from '@supabase/supabase-js'
import { currentKeyId, decrypt, encrypt, keyIdOf } from './lib/bank-crypto.mjs'

const dry = process.argv.includes('--dry-run')
const rotate = process.argv.includes('--rotate')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const current = currentKeyId() // throws if the key configuration is missing/invalid

const tables = [
  { table: 'rider_bank_accounts', key: 'rider_id' },
  { table: 'delivery_fee_payments', key: 'id' },
]
const summary = {}
for (const { table, key } of tables) {
  const { data, error } = await sb
    .from(table)
    .select(`${key}, account_number, account_cipher`)
    .or('account_number.not.is.null,account_cipher.not.is.null')
  if (error) {
    console.error(`${table}: read failed (${error.code ?? 'error'})`)
    process.exit(1)
  }
  let encrypted = 0
  let rotated = 0
  let skipped = 0
  for (const row of data) {
    let plain = null
    let kind = null
    if (row.account_number) {
      plain = row.account_number
      kind = 'encrypt'
    } else if (rotate && row.account_cipher && keyIdOf(row.account_cipher) !== current) {
      plain = decrypt(row.account_cipher)
      kind = 'rotate'
    }
    if (!plain) {
      skipped++
      continue
    }
    if (!/^[0-9]{10}$/.test(plain)) {
      console.error(`${table}: a row has an unexpected number format; left unchanged`)
      skipped++
      continue
    }
    if (!dry) {
      const { error: e } = await sb
        .from(table)
        .update({
          account_cipher: encrypt(plain),
          account_last4: plain.slice(-4),
          account_number: null,
        })
        .eq(key, row[key])
      if (e) {
        console.error(`${table}: update failed (${e.code ?? 'error'}); stopping`)
        process.exit(1)
      }
    }
    if (kind === 'encrypt') encrypted++
    else rotated++
  }
  summary[table] = { encrypted, rotated, unchanged: skipped, dryRun: dry }
}
console.log(JSON.stringify(summary, null, 2))
