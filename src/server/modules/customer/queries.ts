import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type WishlistItem = {
  id: string
  name: string
  price_kobo: number
  available: boolean
  vendor_slug: string
  vendor_name: string
  open_now: boolean
}
export type SavedPlace = {
  id: string
  label: string
  delivery_point_id: string
  delivery_point: string
  is_default: boolean
  point_active: boolean
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc(fn, args)
  return error ? null : (data as T)
}

export const listWishlist = async () => (await rpc<WishlistItem[]>('wishlist_list')) ?? []
export const isWishlisted = async (productId: string) =>
  (await rpc<boolean>('wishlist_contains', { p_product: productId })) === true
export const listSavedPlaces = async () => (await rpc<SavedPlace[]>('saved_places_list')) ?? []

export async function myProfile(): Promise<{
  email: string | null
  displayName: string | null
  createdAt: string | null
}> {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.auth.getUser()
  const u = data.user
  if (!u) return { email: null, displayName: null, createdAt: null }
  const { data: p } = await sb.from('profiles').select('display_name').eq('id', u.id).maybeSingle()
  return {
    email: u.email ?? null,
    displayName: (p?.display_name as string | null | undefined) ?? null,
    createdAt: u.created_at ?? null,
  }
}
