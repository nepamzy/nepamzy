import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/**
 * Who may start a job. Either the job secret (`Authorization: Bearer $JOBS_SECRET`), or the hosting scheduler's own call
 * (a GET from "vercel-cron"). The second is safe for the jobs that use it: each one only does work that is already due,
 * takes no input, and repeating it changes nothing.
 */
export function jobAuthorized(req: Request): boolean {
  const secret = process.env.JOBS_SECRET ?? ''
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (secret.length >= 16) {
    const a = Buffer.from(given)
    const b = Buffer.from(secret)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return req.method === 'GET' && /^vercel-cron\//i.test(req.headers.get('user-agent') ?? '')
}
