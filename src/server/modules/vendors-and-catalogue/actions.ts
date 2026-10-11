'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import { dbFailed, done, failed, gate, int, nairaToKobo, text, type ActionState } from '@/server/modules/shared/action-helpers'
import { buildHoursJson } from './hours'
import { parseOptionGroups } from './options'

const uuid = z.uuid()
const VENDOR = { roles: ['vendor_owner', 'vendor_staff'] as const, aal: 'aal2' as const }
const ADMIN = { roles: ['platform_admin'] as const, aal: 'aal2' as const }
const asReq = (r: { roles: readonly ('vendor_owner' | 'vendor_staff' | 'platform_admin')[]; aal: 'aal2' }) => ({ roles: [...r.roles], aal: r.aal })

// ---------------------------------------------------------------- vendor application (customer)
export async function submitApplicationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in g) return g.state
  if (!(await rateLimit(`apply:${g.who.userId}`, 86400, 5))) return failed('Too many applications today. Please try again tomorrow.')
  const category = text(fd, 'category', 40)
  if (!uuid.safeParse(category).success) return failed('Choose a category.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('submit_vendor_application', {
    p_business_name: text(fd, 'businessName', 80), p_phone: text(fd, 'phone', 20), p_category: category,
    p_description: text(fd, 'description', 500), p_pickup: text(fd, 'pickup', 200), p_accept: fd.get('accept') === 'on',
  })
  if (error) return dbFailed(error, 'Please check the form: name 2-80 characters, a valid phone number, a description of at least 10 characters.')
  revalidatePath('/apply')
  return done('Application received. An administrator will review it.')
}

// ---------------------------------------------------------------- admin
export async function decideApplicationAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(ADMIN)); if ('state' in g) return
  const id = String(fd.get('applicationId') ?? ''); const decision = fd.get('decision') === 'approve' ? 'approve' : 'reject'
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('decide_vendor_application', { p_application: id, p_decision: decision, p_reason: text(fd, 'reason', 500) || null })
  revalidatePath('/admin/applications')
  if (error) redirect(`/admin/applications?error=${encodeURIComponent(dbFailed(error).error ?? 'Failed')}`)
  redirect('/admin/applications?saved=1')
}

export async function setVendorStatusAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(ADMIN)); if ('state' in g) return
  const id = String(fd.get('vendorId') ?? ''); const status = fd.get('status') === 'approved' ? 'approved' : 'suspended'
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('set_vendor_status', { p_vendor: id, p_status: status, p_reason: text(fd, 'reason', 500) })
  revalidatePath('/admin/vendors')
  if (error) redirect(`/admin/vendors?error=${encodeURIComponent(dbFailed(error).error ?? 'Failed')}`)
  redirect('/admin/vendors?saved=1')
}

export async function saveCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(ADMIN)); if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('category_upsert', {
    p_category: uuid.safeParse(id).success ? id : null, p_slug: text(fd, 'slug', 40).toLowerCase(), p_name: text(fd, 'name', 60),
    p_sort: int(fd, 'sort') ?? 0, p_active: fd.get('active') === 'on',
  })
  if (error) return dbFailed(error, 'Check the slug (lowercase letters, numbers, dashes) and name.')
  revalidatePath('/admin/categories')
  return done('Category saved.')
}

export async function saveDeliveryPointAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(ADMIN)); if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('delivery_point_upsert', {
    p_id: uuid.safeParse(id).success ? id : null, p_label: text(fd, 'label', 80), p_instructions: text(fd, 'instructions', 200) || null,
    p_active: fd.get('active') === 'on', p_sort: int(fd, 'sort') ?? 0,
  })
  if (error) return dbFailed(error, 'The label must be 3-80 characters.')
  revalidatePath('/admin/delivery-points')
  return done('Delivery point saved.')
}

// ---------------------------------------------------------------- vendor self-service
async function vendorId(fd: FormData): Promise<string | null> {
  const id = String(fd.get('vendorId') ?? '')
  return uuid.safeParse(id).success ? id : null
}

export async function saveProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return g.state
  const v = await vendorId(fd); if (!v) return failed('Vendor not found.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_update_profile', {
    p_vendor: v, p_description: text(fd, 'description', 500), p_phone: text(fd, 'phone', 20), p_pickup: text(fd, 'pickup', 200), p_prep: int(fd, 'prep') ?? 20,
  })
  if (error) return dbFailed(error, 'Check the phone number and preparation time (1-240 minutes).')
  revalidatePath('/vendor/profile')
  return done('Profile saved.')
}

export async function saveHoursAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return g.state
  const v = await vendorId(fd); if (!v) return failed('Vendor not found.')
  const built = buildHoursJson(fd)
  if ('error' in built) return failed(built.error)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_set_hours', { p_vendor: v, p_hours: built.hours })
  if (error) return dbFailed(error)
  revalidatePath('/vendor/profile')
  return done('Opening hours saved.')
}

export async function setClosedAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return
  const v = await vendorId(fd); if (!v) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('vendor_set_temporarily_closed', { p_vendor: v, p_closed: fd.get('closed') === '1' })
  revalidatePath('/vendor/profile'); revalidatePath('/vendor')
  redirect('/vendor/profile')
}

export async function addStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return g.state
  const v = await vendorId(fd); if (!v) return failed('Vendor not found.')
  const email = z.email().safeParse(text(fd, 'email', 254))
  if (!email.success) return failed('Enter a valid email address.')
  if (!(await rateLimit(`staff:${g.who.userId}`, 3600, 20))) return failed('Too many attempts. Please try later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_add_staff', { p_vendor: v, p_email: email.data })
  if (error) return dbFailed(error)
  revalidatePath('/vendor/profile')
  // Same answer whether or not the person has an account (no account lookup oracle).
  return done('If that person has an AFIT Market account, they now have staff access.')
}

export async function removeStaffAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return
  const v = await vendorId(fd); const u = String(fd.get('userId') ?? '')
  if (!v || !uuid.safeParse(u).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('vendor_remove_staff', { p_vendor: v, p_user: u })
  revalidatePath('/vendor/profile')
  redirect('/vendor/profile')
}

export async function saveProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return g.state
  const v = await vendorId(fd); if (!v) return failed('Vendor not found.')
  const price = nairaToKobo(text(fd, 'price', 20))
  if (price === null || price < 1) return failed('Enter a price in naira, for example 1500 or 1500.50.')
  const stockRaw = text(fd, 'stock', 8)
  let stock: number | null = null
  if (stockRaw !== '') { stock = /^\d{1,6}$/.test(stockRaw) ? Number(stockRaw) : NaN; if (Number.isNaN(stock)) return failed('Stock must be a whole number, or empty for unlimited.') }
  const groups = parseOptionGroups(text(fd, 'options', 20000))
  if ('error' in groups) return failed(groups.error)
  const rawId = text(fd, 'productId', 40)
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('product_upsert', {
    p_vendor: v, p_product: uuid.safeParse(rawId).success ? rawId : null, p_name: text(fd, 'name', 80), p_description: text(fd, 'description', 300),
    p_price: price, p_section: text(fd, 'section', 40), p_available: fd.get('available') === 'on', p_stock: stock, p_options: groups.groups,
  })
  if (error) return dbFailed(error, 'Check the name (2-80 characters) and price.')
  revalidatePath('/vendor/catalogue')
  if (!rawId) redirect(`/vendor/catalogue/${String(data)}?created=1`)
  return done('Product saved.')
}

export async function toggleAvailabilityAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return
  const id = String(fd.get('productId') ?? ''); if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('product_set_availability', { p_product: id, p_available: fd.get('available') === '1' })
  revalidatePath('/vendor/catalogue')
  redirect('/vendor/catalogue')
}

export async function archiveProductAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR)); if ('state' in g) return
  const id = String(fd.get('productId') ?? ''); if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('product_archive', { p_product: id })
  revalidatePath('/vendor/catalogue')
  redirect('/vendor/catalogue')
}
