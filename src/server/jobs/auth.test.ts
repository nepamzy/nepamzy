import { afterEach, describe, expect, it } from 'vitest'
import { jobAuthorized } from './auth'

const req = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://x/api/jobs/run-all', { method, headers })

afterEach(() => {
  delete process.env.JOBS_SECRET
})

describe('jobAuthorized', () => {
  it('accepts the job secret and nothing close to it', () => {
    process.env.JOBS_SECRET = 'a-long-enough-secret-value'
    expect(jobAuthorized(req('POST', { authorization: 'Bearer a-long-enough-secret-value' }))).toBe(
      true,
    )
    expect(jobAuthorized(req('POST', { authorization: 'Bearer a-long-enough-secret-valuX' }))).toBe(
      false,
    )
    expect(jobAuthorized(req('POST', { authorization: 'Bearer short' }))).toBe(false)
    expect(jobAuthorized(req('POST'))).toBe(false)
  })
  it('accepts the hosting scheduler only as a GET', () => {
    expect(jobAuthorized(req('GET', { 'user-agent': 'vercel-cron/1.0' }))).toBe(true)
    expect(jobAuthorized(req('POST', { 'user-agent': 'vercel-cron/1.0' }))).toBe(false)
    expect(jobAuthorized(req('GET', { 'user-agent': 'curl/8' }))).toBe(false)
  })
  it('refuses an unset or short secret even when the caller sends an empty one', () => {
    process.env.JOBS_SECRET = 'short'
    expect(jobAuthorized(req('POST', { authorization: 'Bearer short' }))).toBe(false)
  })
})
