import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

// Every HTTP endpoint must authenticate its caller in code that sits INSIDE the handler (route handlers are outside layouts).
describe('every API route authenticates its caller', () => {
  const routes = walk(join(root, 'src/app/api')).filter((f) => f.endsWith('route.ts'))
  it('there are routes to check', () => expect(routes.length).toBeGreaterThanOrEqual(6))
  // Public by design, and why: a monitor must reach it without credentials, so it reveals only ok / not ok and is rate limited.
  const PUBLIC_BY_DESIGN = ['src/app/api/health/route.ts']
  for (const file of routes) {
    it(file.replace(root + '/', ''), () => {
      const src = readFileSync(file, 'utf8')
      if (PUBLIC_BY_DESIGN.some((p) => file.endsWith(p))) {
        expect(src).toMatch(/rateLimit\(/)
        expect(src).not.toMatch(/process\.env|NODE_ENV|\.version/)
        return
      }
      const ok =
        (/JOBS_SECRET/.test(src) && /timingSafeEqual/.test(src)) || // scheduler endpoints: constant-time secret compare
        /verifySignature\(/.test(src) || // provider webhook: HMAC over the raw body
        /checkAccess\(/.test(src) || // user endpoints: central access decision
        /auth\.getUser\(\)/.test(src) // user endpoints: session check
      expect(ok, `${file} has no recognised authentication`).toBe(true)
    })
  }
})

// Rate-limit review: user-created content and costly actions must call rateLimit() (fails closed). Counts are floors:
// removing a limiter or adding an action without one in these files should be a conscious change to this table.
describe('rate limiting is present where users create content or trigger cost', () => {
  const FLOORS: Record<string, number> = {
    'src/server/modules/identity-and-access/actions.ts': 5,
    'src/server/modules/riders/actions.ts': 6,
    'src/server/modules/engagement/actions.ts': 2,
    'src/server/modules/vendors-and-catalogue/actions.ts': 2,
    'src/server/modules/support/actions.ts': 3,
    'src/server/modules/cart-and-checkout/actions.ts': 2,
    'src/server/modules/payments/actions.ts': 1,
    'src/server/modules/orders-and-state-machine/actions.ts': 3,
    'src/app/api/payments/return/route.ts': 1,
    'src/app/api/orders/[id]/tracking/route.ts': 1,
  }
  for (const [file, floor] of Object.entries(FLOORS)) {
    it(`${file} calls rateLimit at least ${floor} time(s)`, () => {
      const n = (readFileSync(join(root, file), 'utf8').match(/rateLimit\(/g) ?? []).length
      expect(n).toBeGreaterThanOrEqual(floor)
    })
  }
})
