import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { serverEnv } from '@/lib/env'

/** Cookie options: the browser never talks to Supabase directly, so session cookies are HttpOnly. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

/** Supabase client acting AS THE SIGNED-IN USER (RLS applies). */
export async function createSupabaseServerClient() {
  const store = await cookies()
  const env = serverEnv()
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS })
          }
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  })
}
