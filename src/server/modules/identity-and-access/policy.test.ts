import { describe, expect, it } from 'vitest'
import {
  ALL_ROLES,
  ANONYMOUS,
  ROUTE_POLICIES,
  decideAccess,
  isPrivilegedRole,
  policyFor,
  safeNextPath,
  type AppRole,
  type Principal,
} from './policy'

const who = (
  roles: AppRole[],
  aal: 'aal1' | 'aal2',
  hasVerifiedFactor = aal === 'aal2',
): Principal => ({
  authenticated: true,
  userId: 'u',
  roles,
  aal,
  hasVerifiedFactor,
})

describe('decideAccess', () => {
  const req = { roles: ['vendor_owner' as const], aal: 'aal2' as const }
  it('anonymous -> login', () =>
    expect(decideAccess(req, ANONYMOUS)).toEqual({ allow: false, action: 'login' }))
  it('wrong role -> forbidden (even at aal2)', () =>
    expect(decideAccess(req, who(['customer'], 'aal2'))).toEqual({
      allow: false,
      action: 'forbidden',
    }))
  it('right role at aal1 without a factor -> enroll', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal1', false))).toEqual({
      allow: false,
      action: 'mfa-enroll',
    }))
  it('right role at aal1 with a factor -> challenge', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal1', true))).toEqual({
      allow: false,
      action: 'mfa-challenge',
    }))
  it('right role at aal2 -> allow', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal2'))).toEqual({ allow: true }))
  it('privileged users need aal2 even when the route only says aal1', () => {
    const r = { aal: 'aal1' as const }
    expect(decideAccess(r, who(['rider'], 'aal1', true))).toEqual({
      allow: false,
      action: 'mfa-challenge',
    })
    expect(decideAccess(r, who(['customer'], 'aal1', false))).toEqual({ allow: true })
  })
  it('MFA setup pages are reachable at aal1 by everyone signed in', () => {
    const r = { aal: 'aal1' as const, mfaSetup: true }
    for (const role of ALL_ROLES)
      expect(decideAccess(r, who([role], 'aal1', false))).toEqual({ allow: true })
  })
})

describe('route policy matrix (generated)', () => {
  const principals: [string, Principal][] = [
    ['anonymous', ANONYMOUS],
    ...ALL_ROLES.flatMap((r) => [
      [`${r}@aal1`, who([r], 'aal1', false)] as [string, Principal],
      [`${r}@aal1+factor`, who([r], 'aal1', true)] as [string, Principal],
      [`${r}@aal2`, who([r], 'aal2')] as [string, Principal],
    ]),
  ]
  for (const p of ROUTE_POLICIES) {
    it(`${p.prefix}: allow only listed roles at the required assurance level`, () => {
      for (const [label, principal] of principals) {
        const d = decideAccess(p.requirement, principal)
        const roleOk =
          !p.requirement.roles || p.requirement.roles.some((r) => principal.roles.includes(r))
        const aalOk =
          principal.aal === 'aal2' ||
          (p.requirement.aal === 'aal1' &&
            (p.requirement.mfaSetup || !principal.roles.some(isPrivilegedRole)))
        const expected = principal.authenticated && roleOk && aalOk
        expect(d.allow, `${label} on ${p.prefix}`).toBe(expected)
      }
    })
  }
  it('no protected prefix is reachable by anonymous users', () => {
    for (const p of ROUTE_POLICIES) expect(decideAccess(p.requirement, ANONYMOUS).allow).toBe(false)
  })
  it('only platform_admin can reach /admin/roles; staff roles reach /admin/audit', () => {
    expect(
      decideAccess(policyFor('/admin/roles')!.requirement, who(['support_agent'], 'aal2')).allow,
    ).toBe(false)
    expect(
      decideAccess(policyFor('/admin/roles')!.requirement, who(['platform_admin'], 'aal2')).allow,
    ).toBe(true)
    expect(
      decideAccess(policyFor('/admin/audit')!.requirement, who(['support_agent'], 'aal2')).allow,
    ).toBe(true)
    expect(
      decideAccess(policyFor('/admin/audit')!.requirement, who(['finance_admin'], 'aal2')).allow,
    ).toBe(false)
  })
  it('registered customers need aal2 for orders and account', () => {
    expect(decideAccess(policyFor('/orders')!.requirement, who(['customer'], 'aal1')).allow).toBe(
      false,
    )
    expect(decideAccess(policyFor('/account')!.requirement, who(['customer'], 'aal1')).allow).toBe(
      false,
    )
    expect(decideAccess(policyFor('/orders')!.requirement, who(['customer'], 'aal2')).allow).toBe(
      true,
    )
  })
})

describe('policyFor', () => {
  it('matches whole path segments only', () => {
    expect(policyFor('/vendors')).toBeNull()
    expect(policyFor('/vendors/v1')).toBeNull()
    expect(policyFor('/vendor')?.prefix).toBe('/vendor')
    expect(policyFor('/vendor/orders')?.prefix).toBe('/vendor')
    expect(policyFor('/administrator')).toBeNull()
  })
  it('prefers the longest prefix', () =>
    expect(policyFor('/admin/roles/x')?.prefix).toBe('/admin/roles'))
  it('public paths have no policy', () => {
    for (const p of ['/', '/login', '/signup', '/design', '/offline'])
      expect(policyFor(p)).toBeNull()
  })
})

describe('safeNextPath', () => {
  it.each([
    ['/orders', '/orders'],
    ['/orders?x=1', '/orders?x=1'],
    ['https://evil.test', '/'],
    ['//evil.test', '/'],
    ['/\\evil', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [null, '/'],
    ['/login', '/'],
    ['/auth/confirm', '/'],
  ])('%s -> %s', (input, out) => expect(safeNextPath(input as string | null)).toBe(out))
})
