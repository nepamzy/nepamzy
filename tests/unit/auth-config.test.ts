import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The sign-up age gate (migration 20261019000002) tells public sign-ups from administrator-made accounts by
// "unconfirmed at commit". That only holds while email confirmation is required and anonymous sign-ins are off.
describe('auth configuration the age gate depends on', () => {
  const toml = readFileSync('supabase/config.toml', 'utf8')
  it('requires email confirmation', () => {
    const email = toml.slice(toml.indexOf('[auth.email]'))
    expect(email).toMatch(/enable_confirmations\s*=\s*true/)
  })
  it('keeps anonymous sign-ins disabled', () => {
    expect(toml).toMatch(/enable_anonymous_sign_ins\s*=\s*false/)
  })
})
