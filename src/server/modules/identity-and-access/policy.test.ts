import { describe, expect, it } from 'vitest'
import {
  ALL_ROLES,
  ANONYMOUS,
  ROUTE_POLICIES,
  decideAccess,
  experienceOf,
  homeFor,
  isPrivilegedRole,
  policyFor,
  safeNextPath,
  type AppRole,
  type Principal,
  signUpOutcome,
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
  it('staff at aal1 without a factor -> enroll', () =>
    expect(
      decideAccess(
        { roles: ['platform_admin'], aal: 'aal2' },
        who(['platform_admin'], 'aal1', false),
      ),
    ).toEqual({ allow: false, action: 'mfa-enroll' }))
  it('a vendor without an authenticator is let in: the second step is optional', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal1', false))).toEqual({ allow: true }))
  it('right role at aal1 with a factor -> challenge', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal1', true))).toEqual({
      allow: false,
      action: 'mfa-challenge',
    }))
  it('right role at aal2 -> allow', () =>
    expect(decideAccess(req, who(['vendor_owner'], 'aal2'))).toEqual({ allow: true }))
  it('staff need aal2 even when the route only says aal1', () => {
    const r = { aal: 'aal1' as const }
    expect(decideAccess(r, who(['rider'], 'aal1', true))).toEqual({ allow: true })
    expect(decideAccess(r, who(['support_agent'], 'aal1', true))).toEqual({
      allow: false,
      action: 'mfa-challenge',
    })
    expect(decideAccess(r, who(['support_agent'], 'aal1', false))).toEqual({
      allow: false,
      action: 'mfa-enroll',
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
        const staff = principal.roles.some(isPrivilegedRole)
        const needs2 = p.requirement.aal === 'aal2' || (!p.requirement.mfaSetup && staff)
        const aalOk =
          !needs2 || principal.aal === 'aal2' || (!principal.hasVerifiedFactor && !staff)
        const exp = experienceOf(principal)
        const homeOk = !p.requirement.customerOnly || exp === 'customer' || exp === 'admin'
        const expected = principal.authenticated && roleOk && aalOk && homeOk
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
  it('customers reach orders and account without a second step, unless they set one up', () => {
    expect(decideAccess(policyFor('/orders')!.requirement, who(['customer'], 'aal1')).allow).toBe(
      true,
    )
    expect(decideAccess(policyFor('/account')!.requirement, who(['customer'], 'aal1')).allow).toBe(
      true,
    )
    expect(
      decideAccess(policyFor('/orders')!.requirement, who(['customer'], 'aal1', true)).allow,
    ).toBe(false)
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

describe('delivery-fee payment routes', () => {
  it('the admin page is for finance and platform administrators at aal2 only', () => {
    const p = policyFor('/admin/delivery-fee-payments')
    expect(p?.requirement).toEqual({ roles: ['platform_admin', 'finance_admin'], aal: 'aal2' })
    expect(decideAccess(p!.requirement, who(['support_agent'], 'aal2'))).toMatchObject({
      allow: false,
      action: 'forbidden',
    })
    expect(decideAccess(p!.requirement, who(['finance_admin'], 'aal2')).allow).toBe(true)
  })
  it('rider payments and the customer pay screen need their own roles; receipt verification is public', () => {
    expect(policyFor('/rider/payments')?.requirement.roles).toEqual(['rider'])
    expect(policyFor('/orders/abc/delivery-fee')?.requirement.roles).toEqual(['customer'])
    expect(policyFor('/account/receipts')?.requirement.aal).toBe('aal2')
    expect(policyFor('/receipts/' + 'a'.repeat(48))).toBeNull()
  })
})

describe('signUpOutcome', () => {
  it('signs the person in at once when the provider returns a session (confirmation switched off)', () => {
    expect(signUpOutcome({ error: null, hasSession: true })).toBe('signed_in')
  })
  it('asks to check e-mail when confirmation is required (no session)', () => {
    expect(signUpOutcome({ error: null, hasSession: false })).toBe('check_email')
  })
  it('reports a taken address plainly, a weak password, and outages', () => {
    expect(
      signUpOutcome({ error: { code: 'user_already_exists', status: 422 }, hasSession: false }),
    ).toBe('exists')
    expect(signUpOutcome({ error: { code: 'email_exists', status: 422 }, hasSession: false })).toBe(
      'exists',
    )
    expect(
      signUpOutcome({ error: { code: 'weak_password', status: 422 }, hasSession: false }),
    ).toBe('weak_password')
    expect(signUpOutcome({ error: { status: 503 }, hasSession: false })).toBe('unavailable')
    expect(signUpOutcome({ error: {}, hasSession: false })).toBe('unavailable')
  })
  it('keeps other client errors indistinguishable from success', () => {
    expect(
      signUpOutcome({
        error: { code: 'over_email_send_rate_limit', status: 429 },
        hasSession: false,
      }),
    ).toBe('check_email')
  })
})

describe('Administrator / Customer mode', () => {
  const staff = (mode?: 'admin' | 'customer'): Principal => ({
    ...who(['platform_admin', 'customer'], 'aal2'),
    mode,
  })
  it('staff areas close in Customer mode and open again in Administrator mode', () => {
    for (const p of ROUTE_POLICIES.filter(
      (r) => r.requirement.roles && r.requirement.roles.every(isPrivilegedRole),
    )) {
      expect(decideAccess(p.requirement, staff('customer')), p.prefix).toEqual({
        allow: false,
        action: 'switch-mode',
      })
      expect(decideAccess(p.requirement, staff('admin')).allow, p.prefix).toBe(true)
      expect(decideAccess(p.requirement, staff(undefined)).allow, p.prefix).toBe(true)
    }
  })
  it('Customer mode still shows the normal customer experience', () => {
    for (const prefix of ['/orders', '/cart', '/checkout', '/account', '/notifications'])
      expect(decideAccess(policyFor(prefix)!.requirement, staff('customer')).allow, prefix).toBe(
        true,
      )
  })
  it('mode never adds access: a customer, vendor or rider cannot enter staff areas whatever it says', () => {
    for (const r of ['customer', 'vendor_owner', 'rider'] as const)
      for (const mode of ['admin', 'customer'] as const)
        expect(
          decideAccess(policyFor('/admin')!.requirement, { ...who([r], 'aal2'), mode }).allow,
          `${r}/${mode}`,
        ).toBe(false)
  })
  it('mode never lifts the second step for staff', () => {
    expect(
      decideAccess(policyFor('/admin')!.requirement, {
        ...who(['platform_admin'], 'aal1', true),
        mode: 'admin',
      }),
    ).toEqual({ allow: false, action: 'mfa-challenge' })
  })
})

describe('one experience per person', () => {
  const customerOnly = (path: string) => policyFor(path)!.requirement
  it('picks exactly one interface', () => {
    expect(experienceOf({ roles: ['customer'] })).toBe('customer')
    expect(experienceOf({ roles: ['customer', 'vendor_owner'] })).toBe('vendor')
    expect(experienceOf({ roles: ['customer', 'vendor_staff'] })).toBe('vendor')
    expect(experienceOf({ roles: ['customer', 'rider'] })).toBe('rider')
    expect(experienceOf({ roles: ['customer', 'platform_admin'] })).toBe('admin')
    expect(experienceOf({ roles: ['customer', 'platform_admin'], mode: 'customer' })).toBe(
      'customer',
    )
  })
  it('sends a shop or a rider home from every shopping screen, never to the customer screens', () => {
    const paths = [
      '/cart',
      '/orders',
      '/orders/abc',
      '/checkout',
      '/apply',
      '/rider-apply',
      '/account/wishlist',
      '/account/addresses',
      '/account/receipts',
    ]
    for (const path of paths) {
      for (const role of ['vendor_owner', 'vendor_staff', 'rider'] as const) {
        expect(
          decideAccess(customerOnly(path), who(['customer', role], 'aal2')),
          `${role} on ${path}`,
        ).toEqual({ allow: false, action: 'go-home' })
      }
      expect(decideAccess(customerOnly(path), who(['customer'], 'aal2')).allow, path).toBe(true)
    }
  })
  it('keeps the shared account pages open to everyone signed in', () => {
    for (const path of ['/account', '/account/security', '/notifications', '/cases'])
      expect(decideAccess(customerOnly(path), who(['customer', 'rider'], 'aal2')).allow).toBe(true)
  })
  it('each experience has its own home', () => {
    expect(homeFor('vendor')).toBe('/vendor')
    expect(homeFor('rider')).toBe('/rider')
    expect(homeFor('admin')).toBe('/admin')
  })
})
