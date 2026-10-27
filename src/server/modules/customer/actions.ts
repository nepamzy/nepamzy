'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { AccessRequirement } from '@/server/modules/identity-and-access/policy'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

const uuid = z.uuid()
const CUSTOMER: AccessRequirement = { roles: ['customer'], aal: 'aal2' }

/** Saves or removes an item from the wishlist. The answer says which, so the page never shows a state the server did not confirm. */
export async function toggleWishlistAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const id = text(fd, 'productId', 40)
  if (!uuid.safeParse(id).success) return failed('That item was not found.')
  if (!(await rateLimit(`wish:${g.who.userId}`, 600, 60)))
    return failed('Too many changes. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('wishlist_toggle', { p_product: id })
  if (error) {
    if (error.message === 'wishlist_full')
      return failed('Your wishlist is full (100 items). Remove one first.')
    return dbFailed(error, 'Could not update your wishlist.')
  }
  revalidatePath('/account/wishlist')
  return done(data === true ? 'Saved to your wishlist.' : 'Removed from your wishlist.')
}

export async function savePlaceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  const point = text(fd, 'point', 40)
  const label = text(fd, 'label', 40)
  if ((id && !uuid.safeParse(id).success) || !uuid.safeParse(point).success)
    return failed('Choose a delivery point.')
  if (label.length < 2) return failed('Give this place a short name (at least 2 letters).')
  if (!(await rateLimit(`place:${g.who.userId}`, 600, 30)))
    return failed('Too many changes. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('saved_place_save', {
    p_id: id || null,
    p_label: label,
    p_point: point,
    p_default: text(fd, 'default', 5) === 'on',
  })
  if (error) {
    if (error.message === 'too_many_places')
      return failed('You can save up to five places. Remove one first.')
    return dbFailed(error, 'Could not save this place.')
  }
  revalidatePath('/account/addresses')
  return done(id ? 'Place updated.' : 'Place saved.')
}

export async function deletePlaceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(CUSTOMER)
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  if (!uuid.safeParse(id).success) return failed('That place was not found.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('saved_place_delete', { p_id: id })
  if (error) return dbFailed(error, 'Could not remove this place.')
  revalidatePath('/account/addresses')
  return done('Place removed.')
}

export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate({ aal: 'aal2' })
  if ('state' in g) return g.state
  const name = text(fd, 'displayName', 80)
  if (name.length < 1) return failed('Enter the name you want us to use.')
  if (!(await rateLimit(`profile:${g.who.userId}`, 600, 20)))
    return failed('Too many changes. Please wait a moment.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb
    .from('profiles')
    .update({ display_name: name })
    .eq('id', g.who.userId!)
    .select('id')
  if (error || !data || data.length === 0)
    return failed('Could not save your name. Please try again.')
  revalidatePath('/account')
  return done('Saved.')
}
