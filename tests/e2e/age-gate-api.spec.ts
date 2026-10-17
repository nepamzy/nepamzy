// The 18+ self-declaration is enforced by the database on the Auth API's public sign-up path (migration 20261019000002).
// These go through the real Auth API (not the web form) to prove a hand-made request cannot skip the declaration.
// WHAT THIS DOES NOT PROVE: age. It proves a declaration was made; nobody's age is verified.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { admin, PASSWORD, uniqueEmail } from './helpers'

const anon = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
const exists = async (email: string) => {
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 })
  return data.users.some((u) => u.email === email)
}

test('a raw sign-up request without the declaration is rejected and creates no account', async () => {
  const email = uniqueEmail('raw-nodecl')
  const r = await anon().auth.signUp({ email, password: PASSWORD })
  expect(r.error).not.toBeNull()
  expect(await exists(email)).toBe(false)
})

test('a raw sign-up with adult_declared false, or a non-boolean look-alike, is rejected', async () => {
  for (const [label, value] of [
    ['false', false],
    ['string-no', 'no'],
    ['number', 1],
    ['string-true', 'true'],
    ['array', [true]],
  ] as const) {
    const email = uniqueEmail(`raw-${label}`)
    const r = await anon().auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { adult_declared: value } },
    })
    expect(r.error, label).not.toBeNull()
    expect(await exists(email), label).toBe(false)
  }
})

test('a raw sign-up that carries the declaration is accepted, and the time is recorded', async () => {
  const email = uniqueEmail('raw-decl')
  const r = await anon().auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { adult_declared: true } },
  })
  expect(r.error).toBeNull()
  const id = r.data.user!.id
  const { data } = await admin().from('profiles').select('adult_declared_at').eq('id', id).single()
  expect(data?.adult_declared_at).not.toBeNull()
})

test('administrator-created (confirmed) and invited accounts still work', async () => {
  const email = uniqueEmail('adm-ok')
  const a = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  expect(a.error).toBeNull()
  const inv = await admin().auth.admin.inviteUserByEmail(uniqueEmail('invited'))
  expect(inv.error).toBeNull()
})

test('an administrator-created account that is neither confirmed nor invited is refused (fixtures must confirm)', async () => {
  const email = uniqueEmail('adm-unconf')
  const a = await admin().auth.admin.createUser({ email, password: PASSWORD })
  expect(a.error).not.toBeNull()
  expect(await exists(email)).toBe(false)
})
