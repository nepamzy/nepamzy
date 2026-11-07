import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Tiny poll used by the open app to play the notification sound: the id of the person's newest unread notification
 * (their own rows only, by row security). Returns no text, so nothing private leaves here.
 */
export async function GET() {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return NextResponse.json({ signedIn: false }, { status: 401 })
  const { data } = await sb
    .from('notifications')
    .select('id')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  return NextResponse.json(
    { signedIn: true, id: data?.[0]?.id ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
