import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notifyWelcome } from '@/server/modules/engagement/dispatch'

/** Email confirmation landing: exchanges the one-time token hash, then sends the user to sign in. */
export async function GET(request: NextRequest) {
  const base = serverEnv().SITE_URL
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  if (!tokenHash || type !== 'email') return NextResponse.redirect(new URL('/login?error=1', base))
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
  if (error) return NextResponse.redirect(new URL('/login?error=1', base))
  if (data.user?.email) notifyWelcome(data.user.email)
  // Do not keep the confirmation session: the user signs in normally (password + MFA).
  await supabase.auth.signOut({ scope: 'local' })
  return NextResponse.redirect(new URL('/login?confirmed=1', base))
}
