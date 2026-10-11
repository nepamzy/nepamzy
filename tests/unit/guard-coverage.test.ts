import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTE_POLICIES } from '@/server/modules/identity-and-access/policy'

// Guard coverage: every protected prefix MUST have a layout that calls enforceRoutePolicy(prefix),
// so a new page under it cannot accidentally ship unprotected.
describe('every protected route prefix is guarded by its layout', () => {
  for (const p of ROUTE_POLICIES) {
    it(p.prefix, () => {
      const file = join(process.cwd(), 'src/app', p.prefix, 'layout.tsx')
      expect(existsSync(file), `missing ${file}`).toBe(true)
      const src = readFileSync(file, 'utf8')
      // Either the layout calls the guard itself, or it uses the shared CustomerLayout with its own prefix.
      const direct = src.includes(`enforceRoutePolicy('${p.prefix}')`)
      const viaShared = src.includes(`<CustomerLayout prefix="${p.prefix}"`)
      expect(direct || viaShared, `${file} must guard ${p.prefix}`).toBe(true)
    })
  }
})

describe('shared layout helper', () => {
  it('CustomerLayout enforces the policy for the prefix it is given, before rendering anything', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/shells/customer-layout.tsx'), 'utf8')
    const guard = src.indexOf('await enforceRoutePolicy(prefix)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(src.indexOf('return <AppShell'))
  })
})

describe('server-only boundaries', () => {
  it('the service-role client is never imported from client components', async () => {
    const { execSync } = await import('node:child_process')
    const files = execSync('grep -rl "use client" src --include=*.tsx --include=*.ts || true', {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
    expect(files.length).toBeGreaterThan(3)
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(/supabase\/service|SUPABASE_SERVICE_ROLE_KEY|server-only/)
    }
  })
  it('no NEXT_PUBLIC_ variables are used anywhere in src (browser never gets Supabase config)', async () => {
    const { execSync } = await import('node:child_process')
    const hits = execSync('grep -rn "NEXT_PUBLIC_" src || true', { encoding: 'utf8' }).trim()
    expect(hits).toBe('')
  })
})
