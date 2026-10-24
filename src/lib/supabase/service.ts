import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { serverEnv, serviceEnv } from '@/lib/env'

/**
 * Service-role client (bypasses RLS). SERVER ONLY, used for audited security helpers
 * (rate limiting, security events) and admin tasks. Never import this from client components.
 */
export function createSupabaseServiceClient() {
  return createClient(serverEnv().SUPABASE_URL, serviceEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
