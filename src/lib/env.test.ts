import { afterEach, describe, expect, it } from 'vitest'
import { serverEnv, serviceEnv } from './env'

const keep = { ...process.env }
afterEach(() => { process.env = { ...keep } })

describe('env validation', () => {
  it('fails fast naming variables but never printing values', () => {
    process.env.SUPABASE_URL = 'not-a-url-SECRETVALUE'
    process.env.SITE_URL = 'http://127.0.0.1:3000'
    process.env.SUPABASE_PUBLISHABLE_KEY = 'short'
    let msg = ''
    try { serverEnv() } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/SUPABASE_URL/)
    expect(msg).toMatch(/SUPABASE_PUBLISHABLE_KEY/)
    expect(msg).not.toMatch(/SECRETVALUE/)
  })
  it('requires the service key separately', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => serviceEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})
