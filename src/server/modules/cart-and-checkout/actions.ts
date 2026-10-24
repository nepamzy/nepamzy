'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { describeProblems, friendlyDbError, parseProblems } from '@/lib/db-errors'
import { mockPaymentsAllowed } from '@/lib/env'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import {
  dbFailed,
  failed,
  gate,
  gateOrRedirect,
  type ActionState,
} from '@/server/modules/shared/action-helpers'

export type CartFormState = ActionState & { conflict?: boolean }
export type CheckoutState = ActionState & { problems?: string[] }
const uuid = z.uuid()

export async function addToCartAction(_p: CartFormState, fd: FormData): Promise<CartFormState> {
  const productId = String(fd.get('productId') ?? '')
  if (!uuid.safeParse(productId).success) return failed('That item was not found.')
  // Sends visitors to sign in (or confirm their code) and brings them back to this product afterwards.
  const who = await gateOrRedirect({ roles: ['customer'], aal: 'aal1' }, `/products/${productId}`)
  const qty = Number(fd.get('quantity') ?? 1)
  // single-choice groups post as option-<groupId>, multi-choice groups as repeated `option`
  const options = [...fd.entries()]
    .filter(([k]) => k === 'option' || k.startsWith('option-'))
    .map(([, v]) => String(v))
    .filter((o) => uuid.safeParse(o).success)
  if (!Number.isInteger(qty) || qty < 1) return failed('Choose a quantity of at least 1.')
  if (!(await rateLimit(`cart:${who.userId}`, 600, 120)))
    return failed('Too many changes. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('cart_add_item', {
    p_product: productId,
    p_qty: qty,
    p_options: options,
    p_replace: fd.get('replace') === '1',
  })
  if (error) return dbFailed(error)
  if ((data as { status: string }).status === 'vendor_conflict') {
    return {
      conflict: true,
      error:
        'Your cart already has items from another vendor. You can only order from one vendor at a time.',
    }
  }
  revalidatePath('/cart')
  redirect('/cart')
}

export async function setQuantityAction(fd: FormData): Promise<void> {
  const item = String(fd.get('itemId') ?? '')
  // The Remove button posts `remove=1`; it must win over the number field in the same form.
  const qty = fd.get('remove') === '1' ? 0 : Number(fd.get('quantity'))
  if (!uuid.safeParse(item).success || !Number.isInteger(qty)) redirect('/cart')
  await gateOrRedirect({ roles: ['customer'], aal: 'aal1' }, '/cart')
  const sb = await createSupabaseServerClient()
  await sb.rpc('cart_set_quantity', { p_item: item, p_qty: qty })
  revalidatePath('/cart')
  redirect('/cart')
}

export async function clearCartAction(): Promise<void> {
  await gateOrRedirect({ roles: ['customer'], aal: 'aal1' }, '/cart')
  const sb = await createSupabaseServerClient()
  await sb.rpc('cart_clear')
  revalidatePath('/cart')
  redirect('/cart')
}

export async function placeOrderAction(_p: CheckoutState, fd: FormData): Promise<CheckoutState> {
  const gated = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in gated) return gated.state
  const fulfilment =
    fd.get('fulfilment') === 'delivery'
      ? 'delivery'
      : fd.get('fulfilment') === 'pickup'
        ? 'pickup'
        : null
  if (!fulfilment) return failed('Choose pickup or delivery.')
  const pointRaw = String(fd.get('point') ?? '')
  const point = uuid.safeParse(pointRaw).success ? pointRaw : null
  const key = String(fd.get('idempotencyKey') ?? '')
  if (key.length < 8 || key.length > 80) return failed('Please reload the page and try again.')
  if (!(await rateLimit(`checkout:${gated.who.userId}`, 600, 20)))
    return failed('Too many attempts. Please wait a few minutes.')
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('create_order', {
    p_fulfilment: fulfilment,
    p_delivery_point: point,
    p_idempotency_key: key,
  })
  if (error) {
    if (error.message === 'checkout_blocked') {
      const problems = describeProblems(parseProblems(error.details))
      return { error: problems[0] ?? friendlyDbError(error), problems }
    }
    return dbFailed(error)
  }
  revalidatePath('/orders')
  revalidatePath('/cart')
  redirect(`/orders/${String(data)}`)
}

/** MOCK payment: exists only when APP_ENV=local AND the database flag is on. Never real money. */
export async function mockPayAction(fd: FormData): Promise<void> {
  const id = String(fd.get('orderId') ?? '')
  if (!uuid.safeParse(id).success || !mockPaymentsAllowed()) redirect('/orders')
  await gateOrRedirect({ roles: ['customer'], aal: 'aal2' }, `/orders/${id}`)
  const sb = await createSupabaseServerClient()
  await sb.rpc('mock_pay_order', { p_order: id })
  revalidatePath(`/orders/${id}`)
  redirect(`/orders/${id}`)
}

export async function cancelOrderAction(fd: FormData): Promise<void> {
  const id = String(fd.get('orderId') ?? '')
  if (!uuid.safeParse(id).success) redirect('/orders')
  await gateOrRedirect({ roles: ['customer'], aal: 'aal2' }, `/orders/${id}`)
  const sb = await createSupabaseServerClient()
  await sb.rpc('cancel_unpaid_order', { p_order: id })
  revalidatePath(`/orders/${id}`)
  redirect(`/orders/${id}`)
}
