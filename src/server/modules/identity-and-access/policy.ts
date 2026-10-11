/**
 * Single source of truth for who may reach what. Pure functions (no I/O) so the whole matrix is
 * unit-testable. The database enforces the same rules independently (RLS + aal2 policies).
 */
export type Aal = 'aal1' | 'aal2'
export type AppRole =
  | 'customer'
  | 'vendor_owner'
  | 'vendor_staff'
  | 'rider'
  | 'support_agent'
  | 'finance_admin'
  | 'platform_admin'

export const ALL_ROLES: AppRole[] = [
  'customer',
  'vendor_owner',
  'vendor_staff',
  'rider',
  'support_agent',
  'finance_admin',
  'platform_admin',
]
/** Everything except `customer` must be at aal2 for any protected access (mirrors the DB). */
export const isPrivilegedRole = (r: AppRole) => r !== 'customer'

export type Principal = {
  authenticated: boolean
  userId: string | null
  roles: AppRole[]
  aal: Aal | null
  /** The user has at least one verified TOTP factor. */
  hasVerifiedFactor: boolean
}
export const ANONYMOUS: Principal = {
  authenticated: false,
  userId: null,
  roles: [],
  aal: null,
  hasVerifiedFactor: false,
}

export type AccessRequirement = {
  /** Any-of. Undefined = any signed-in user. */
  roles?: AppRole[]
  aal: Aal
  /** MFA enrollment/challenge pages themselves must be reachable at aal1. */
  mfaSetup?: boolean
}

export type Decision =
  { allow: true } | { allow: false; action: 'login' | 'forbidden' | 'mfa-enroll' | 'mfa-challenge' }

export function decideAccess(req: AccessRequirement, who: Principal): Decision {
  if (!who.authenticated) return { allow: false, action: 'login' }
  if (req.roles && !req.roles.some((r) => who.roles.includes(r))) {
    return { allow: false, action: 'forbidden' }
  }
  const needsAal2 =
    req.aal === 'aal2' || (!req.mfaSetup && who.roles.some((r) => isPrivilegedRole(r)))
  if (needsAal2 && who.aal !== 'aal2') {
    return { allow: false, action: who.hasVerifiedFactor ? 'mfa-challenge' : 'mfa-enroll' }
  }
  return { allow: true }
}

export type RoutePolicy = { prefix: string; requirement: AccessRequirement }

/** Longest matching prefix wins. Paths not listed here are public. */
export const ROUTE_POLICIES: RoutePolicy[] = [
  { prefix: '/admin/roles', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/applications', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/vendors', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/delivery-points', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/categories', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/riders', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  {
    prefix: '/admin/rider-issues',
    requirement: { roles: ['platform_admin', 'support_agent'], aal: 'aal2' },
  },
  {
    prefix: '/admin/payments',
    requirement: { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' },
  },
  {
    prefix: '/admin/audit',
    requirement: { roles: ['platform_admin', 'support_agent'], aal: 'aal2' },
  },
  {
    prefix: '/admin',
    requirement: { roles: ['platform_admin', 'support_agent', 'finance_admin'], aal: 'aal2' },
  },
  { prefix: '/vendor', requirement: { roles: ['vendor_owner', 'vendor_staff'], aal: 'aal2' } },
  { prefix: '/rider', requirement: { roles: ['rider'], aal: 'aal2' } },
  { prefix: '/orders', requirement: { roles: ['customer'], aal: 'aal2' } },
  // The cart is usable at aal1 by plain customers (privileged accounts are lifted to aal2 by decideAccess);
  // checkout, vendor applications and everything that creates orders need aal2.
  { prefix: '/cart', requirement: { roles: ['customer'], aal: 'aal1' } },
  { prefix: '/checkout', requirement: { roles: ['customer'], aal: 'aal2' } },
  { prefix: '/apply', requirement: { roles: ['customer'], aal: 'aal2' } },
  { prefix: '/rider-apply', requirement: { roles: ['customer'], aal: 'aal2' } },
  { prefix: '/account', requirement: { aal: 'aal2' } },
  { prefix: '/mfa', requirement: { aal: 'aal1', mfaSetup: true } },
]

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + '/')

export function policyFor(pathname: string): RoutePolicy | null {
  const hits = ROUTE_POLICIES.filter((p) => matches(pathname, p.prefix))
  if (hits.length === 0) return null
  return hits.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a))
}

/** Only same-site relative paths are accepted as post-login redirect targets. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  if (/^\/(login|signup|auth)(\/|$)/.test(next)) return '/'
  return next
}
