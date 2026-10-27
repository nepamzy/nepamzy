/**
 * Single source of truth for who may reach what. Pure functions (no I/O) so the whole matrix is
 * unit-testable. The database enforces the same rules independently (RLS + aal2 policies).
 */
export type Aal = 'aal1' | 'aal2'
/** Cookie that remembers a staff member's chosen interface (see Principal.mode). */
export const MODE_COOKIE = 'afit_mode'
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
/**
 * Staff roles must use the second sign-in step (mirrors the DB). Everyone else may switch it on from their
 * account page; once they have, it is enforced for them too.
 */
export const isPrivilegedRole = (r: AppRole) =>
  r === 'platform_admin' || r === 'finance_admin' || r === 'support_agent'

export type Principal = {
  authenticated: boolean
  userId: string | null
  roles: AppRole[]
  aal: Aal | null
  /** The user has at least one verified TOTP factor. */
  hasVerifiedFactor: boolean
  /**
   * Which interface a staff member is using. It only ever REMOVES access (customer mode hides staff areas); it never adds any:
   * every staff area still requires the staff role, and the second step, whatever this says. Undefined means `admin`.
   */
  mode?: 'admin' | 'customer'
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
  | { allow: true }
  | { allow: false; action: 'login' | 'forbidden' | 'mfa-enroll' | 'mfa-challenge' | 'switch-mode' }

export function decideAccess(req: AccessRequirement, who: Principal): Decision {
  if (!who.authenticated) return { allow: false, action: 'login' }
  if (req.roles && !req.roles.some((r) => who.roles.includes(r))) {
    return { allow: false, action: 'forbidden' }
  }
  const staff = who.roles.some((r) => isPrivilegedRole(r))
  // A staff-only area is closed while the person is browsing in Customer mode: they switch back on purpose.
  if (req.roles && req.roles.every((r) => isPrivilegedRole(r)) && who.mode === 'customer')
    return { allow: false, action: 'switch-mode' }
  const needsAal2 = req.aal === 'aal2' || (!req.mfaSetup && staff)
  // The second step counts as satisfied when it was completed, or when it is optional for this person:
  // not staff and no authenticator set up.
  const satisfied = who.aal === 'aal2' || (!who.hasVerifiedFactor && !staff)
  if (needsAal2 && !satisfied) {
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
    prefix: '/admin/cases',
    requirement: { roles: ['platform_admin', 'support_agent'], aal: 'aal2' },
  },
  {
    prefix: '/admin/returns',
    requirement: { roles: ['platform_admin', 'support_agent'], aal: 'aal2' },
  },
  {
    prefix: '/admin/refunds',
    requirement: { roles: ['platform_admin', 'support_agent', 'finance_admin'], aal: 'aal2' },
  },
  {
    prefix: '/admin/reviews',
    requirement: { roles: ['platform_admin', 'support_agent'], aal: 'aal2' },
  },
  { prefix: '/admin/data-requests', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  {
    prefix: '/admin/settlements',
    requirement: { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' },
  },
  {
    prefix: '/admin/delivery-fee-payments',
    requirement: { roles: ['platform_admin', 'finance_admin'], aal: 'aal2' },
  },
  { prefix: '/admin/settings', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
  { prefix: '/admin/jobs', requirement: { roles: ['platform_admin'], aal: 'aal2' } },
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
  { prefix: '/notifications', requirement: { aal: 'aal2' } },
  // Reports (support cases): customers, shops and riders who are a party see their own; the database decides which.
  { prefix: '/cases', requirement: { aal: 'aal2' } },
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

export type SignUpOutcome = 'signed_in' | 'check_email' | 'weak_password' | 'exists' | 'unavailable'

/**
 * What a sign-up attempt means for the person. When the project requires e-mail confirmation the provider returns no
 * session (and hides whether the address is taken), so the person is told to check their e-mail. When confirmation is
 * switched off in the provider settings it returns a session at once: the person is signed in and may confirm later
 * or never, and an address that is already taken is reported plainly because it cannot be hidden any more.
 */
export function signUpOutcome(r: {
  error?: { code?: string; status?: number } | null
  hasSession: boolean
}): SignUpOutcome {
  const e = r.error
  if (e?.code === 'weak_password') return 'weak_password'
  if (e?.code === 'user_already_exists' || e?.code === 'email_exists') return 'exists'
  if (e && (!e.status || e.status >= 500)) return 'unavailable'
  if (e) return 'check_email'
  return r.hasSession ? 'signed_in' : 'check_email'
}
