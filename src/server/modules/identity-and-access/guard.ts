import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  ANONYMOUS,
  ROUTE_POLICIES,
  decideAccess,
  isPrivilegedRole,
  MODE_COOKIE,
  safeNextPath,
  type AccessRequirement,
  type AppRole,
  type Decision,
  type Principal,
} from './policy'

/** Who is calling? Identity is validated with Supabase Auth (getUser), never trusted from cookies alone. */
export const loadPrincipal = cache(async (): Promise<Principal> => {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return ANONYMOUS
  const [{ data: aal }, { data: roles }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('my_roles'),
  ])
  const roleList = (roles ?? []) as AppRole[]
  // The mode cookie can only choose the lighter interface. A non-staff account is always `customer`.
  const staff = roleList.some(isPrivilegedRole)
  const chosen = (await cookies()).get(MODE_COOKIE)?.value
  return {
    authenticated: true,
    userId: data.user.id,
    roles: roleList,
    mode: staff && chosen !== 'customer' ? 'admin' : 'customer',
    aal: aal?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    hasVerifiedFactor: aal?.nextLevel === 'aal2' || aal?.currentLevel === 'aal2',
  }
})

async function currentPath(): Promise<string> {
  return safeNextPath((await headers()).get('x-pathname'))
}

/** For pages/layouts: redirects to login / MFA, or renders the 403 page. */
export async function requireAuth(req: AccessRequirement): Promise<Principal> {
  const who = await loadPrincipal()
  const d = decideAccess(req, who)
  if (d.allow) return who
  const next = encodeURIComponent(await currentPath())
  switch (d.action) {
    case 'login':
      redirect(`/login?next=${next}`)
    case 'mfa-enroll':
      redirect(`/mfa/enroll?next=${next}`)
    case 'mfa-challenge':
      redirect(`/mfa/challenge?next=${next}`)
    case 'switch-mode':
      redirect(`/account/mode?next=${next}`)
    case 'forbidden':
      forbidden()
  }
}

/** For server actions/handlers: returns a decision instead of redirecting. */
export async function checkAccess(
  req: AccessRequirement,
): Promise<{ who: Principal; decision: Decision }> {
  const who = await loadPrincipal()
  return { who, decision: decideAccess(req, who) }
}

/** Enforce the central route policy for a prefix; every protected segment layout must call this. */
export async function enforceRoutePolicy(prefix: string): Promise<Principal> {
  const policy = ROUTE_POLICIES.find((p) => p.prefix === prefix)
  if (!policy) throw new Error(`No route policy registered for ${prefix}`)
  return requireAuth(policy.requirement)
}
