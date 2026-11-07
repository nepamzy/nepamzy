import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
const upserts: Record<string, unknown>[] = []
let principal: { userId: string | null } = { userId: 'user-A' }
let allowed = true
vi.mock('@/server/modules/shared/action-helpers', async () => {
  const real = await vi
    .importActual<typeof import('@/server/modules/shared/action-helpers')>(
      '@/server/modules/shared/action-helpers',
    )
    .catch(() => null)
  return {
    ...(real ?? {}),
    gate: async () =>
      allowed
        ? { who: principal }
        : {
            state: {
              ok: false,
              error: 'Please sign in and confirm your authenticator code to continue.',
            },
          },
    failed: (error: string) => ({ ok: false, error }),
    done: (message: string) => ({ ok: true, message }),
  }
})
vi.mock('@/server/modules/identity-and-access/security', () => ({
  rateLimit: async () => true,
  sha256Hex: (s: string) => s,
  clientIp: async () => '1.1.1.1',
}))
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row)
        return { error: null }
      },
    }),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/server/modules/identity-and-access/guard', () => ({ loadPrincipal: async () => ({}) }))
vi.mock('./admin-alerts', () => ({ notifyAdmin: () => undefined }))
vi.mock('./mail', () => ({ mailConfig: () => null, sendMailDetailed: async () => ({}) }))
vi.mock('./queries', () => ({ EDITABLE_SETTINGS: [] }))

import { savePushSubscriptionAction } from './actions'

const GOOD = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abcdefghijklmnop',
  p256dh: 'p'.repeat(40),
  auth: 'a'.repeat(16),
}

beforeEach(() => {
  upserts.length = 0
  principal = { userId: 'user-A' }
  allowed = true
})

describe('saving a phone-alert subscription', () => {
  it('saves it for the signed-in person only', async () => {
    const r = await savePushSubscriptionAction(GOOD)
    expect(r.ok).toBe(true)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ user_id: 'user-A', endpoint: GOOD.endpoint })
  })
  it("cannot subscribe someone else's phone: a user_id in the input is ignored", async () => {
    await savePushSubscriptionAction({ ...GOOD, user_id: 'user-B' })
    expect(upserts[0]?.user_id).toBe('user-A')
  })
  it('refuses a signed-out visitor', async () => {
    allowed = false
    const r = await savePushSubscriptionAction(GOOD)
    expect(r.ok).toBe(false)
    expect(upserts).toHaveLength(0)
  })
  it('refuses an address that is not a real push service', async () => {
    const r = await savePushSubscriptionAction({ ...GOOD, endpoint: 'https://10.0.0.1/x' })
    expect(r.ok).toBe(false)
    expect(upserts).toHaveLength(0)
  })
})
