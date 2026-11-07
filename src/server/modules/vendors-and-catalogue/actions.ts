'use server'

import { notifyAdmin } from '@/server/modules/engagement/admin-alerts'
import {
  notifyApplicationDecision,
  notifyApplicationReceived,
} from '@/server/modules/engagement/dispatch'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import {
  dbFailed,
  done,
  failed,
  gate,
  int,
  nairaToKobo,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'
import { STARTER_ITEMS, startersFor } from '@/lib/starter-catalogue'
import { buildHoursJson } from './hours'
import { parseOptionGroups } from './options'
import { parseVendorChoices } from './vendor-choices'

const uuid = z.uuid()
const VENDOR = { roles: ['vendor_owner', 'vendor_staff'] as const, aal: 'aal2' as const }
const ADMIN = { roles: ['platform_admin'] as const, aal: 'aal2' as const }
const asReq = (r: {
  roles: readonly ('vendor_owner' | 'vendor_staff' | 'platform_admin')[]
  aal: 'aal2'
}) => ({ roles: [...r.roles], aal: r.aal })

// ---------------------------------------------------------------- vendor application (customer)
export async function submitApplicationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate({ roles: ['customer'], aal: 'aal2' })
  if ('state' in g) return g.state
  if (!(await rateLimit(`apply:${g.who.userId}`, 86400, 5)))
    return failed('Too many applications today. Please try again tomorrow.')
  const { listCategories } = await import('./public')
  const choices = parseVendorChoices(fd, await listCategories())
  if (!choices.ok) return failed(choices.error)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('submit_vendor_application', {
    p_business_name: text(fd, 'businessName', 80),
    p_phone: text(fd, 'phone', 20),
    p_category: choices.main,
    p_description: text(fd, 'description', 500),
    p_pickup: text(fd, 'pickup', 200),
    p_accept: fd.get('accept') === 'on',
    p_extra_categories: choices.extras,
    p_other_category: choices.other,
    p_vendor_type: choices.type,
    p_shop_place: choices.place,
  })
  if (error)
    return dbFailed(
      error,
      'Please check the form: name 2-80 characters, a valid phone number, a description of at least 10 characters.',
    )
  notifyAdmin({ type: 'vendor_application', businessName: text(fd, 'businessName', 80) })
  notifyApplicationReceived((await sb.auth.getUser()).data.user?.email, 'vendor')
  revalidatePath('/apply')
  return done('Application received. An administrator will review it.')
}

// ---------------------------------------------------------------- admin
export async function decideApplicationAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(ADMIN))
  if ('state' in g) return
  const id = String(fd.get('applicationId') ?? '')
  const decision = fd.get('decision') === 'approve' ? 'approve' : 'reject'
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('decide_vendor_application', {
    p_application: id,
    p_decision: decision,
    p_reason: text(fd, 'reason', 500) || null,
  })
  revalidatePath('/admin/applications')
  if (!error)
    notifyApplicationDecision('vendor_applications', id, {
      kind: 'vendor',
      approved: decision === 'approve',
      reason: text(fd, 'reason', 500) || null,
    })
  if (error)
    redirect(`/admin/applications?error=${encodeURIComponent(dbFailed(error).error ?? 'Failed')}`)
  redirect('/admin/applications?saved=1')
}

export async function setVendorStatusAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(ADMIN))
  if ('state' in g) return
  const id = String(fd.get('vendorId') ?? '')
  const status = fd.get('status') === 'approved' ? 'approved' : 'suspended'
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('set_vendor_status', {
    p_vendor: id,
    p_status: status,
    p_reason: text(fd, 'reason', 500),
  })
  revalidatePath('/admin/vendors')
  if (error)
    redirect(`/admin/vendors?error=${encodeURIComponent(dbFailed(error).error ?? 'Failed')}`)
  redirect('/admin/vendors?saved=1')
}

export async function saveCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(ADMIN))
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('category_upsert', {
    p_category: uuid.safeParse(id).success ? id : null,
    p_slug: text(fd, 'slug', 40).toLowerCase(),
    p_name: text(fd, 'name', 60),
    p_sort: int(fd, 'sort') ?? 0,
    p_active: fd.get('active') === 'on',
  })
  if (error) return dbFailed(error, 'Check the slug (lowercase letters, numbers, dashes) and name.')
  revalidatePath('/admin/categories')
  return done('Category saved.')
}

export async function saveDeliveryPointAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(ADMIN))
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('delivery_point_upsert', {
    p_id: uuid.safeParse(id).success ? id : null,
    p_label: text(fd, 'label', 80),
    p_instructions: text(fd, 'instructions', 200) || null,
    p_active: fd.get('active') === 'on',
    p_sort: int(fd, 'sort') ?? 0,
  })
  if (error) return dbFailed(error, 'The label must be 3-80 characters.')
  revalidatePath('/admin/delivery-points')
  return done('Delivery point saved.')
}

export async function setDeliveryPointGeoAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate(asReq(ADMIN))
  if ('state' in g) return g.state
  const id = text(fd, 'id', 40)
  if (!uuid.safeParse(id).success) return failed('That delivery point was not found.')
  const lat = Number(text(fd, 'lat', 20).replace(',', '.'))
  const lng = Number(text(fd, 'lng', 20).replace(',', '.'))
  const radius = int(fd, 'radius') ?? 60
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return failed('Enter latitude and longitude as plain numbers, for example 10.5105 and 7.4165.')
  if (radius < 10 || radius > 500)
    return failed('The arrival radius must be between 10 and 500 metres.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('delivery_point_set_geo', {
    p_id: id,
    p_lat: lat,
    p_lng: lng,
    p_radius: radius,
    p_real: fd.get('real') === 'on',
  })
  if (error) return dbFailed(error, 'Could not save the location.')
  revalidatePath('/admin/delivery-points')
  return done('Location saved. New deliveries to this point use it.')
}

// ---------------------------------------------------------------- vendor self-service
async function vendorId(fd: FormData): Promise<string | null> {
  const id = String(fd.get('vendorId') ?? '')
  return uuid.safeParse(id).success ? id : null
}

export async function saveProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  if (!v) return failed('Vendor not found.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_update_profile', {
    p_vendor: v,
    p_description: text(fd, 'description', 500),
    p_phone: text(fd, 'phone', 20),
    p_pickup: text(fd, 'pickup', 200),
    p_prep: int(fd, 'prep') ?? 20,
  })
  if (error) return dbFailed(error, 'Check the phone number and preparation time (1-240 minutes).')
  revalidatePath('/vendor/profile')
  return done('Profile saved.')
}

export async function saveHoursAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  if (!v) return failed('Vendor not found.')
  const built = buildHoursJson(fd)
  if ('error' in built) return failed(built.error)
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_set_hours', { p_vendor: v, p_hours: built.hours })
  if (error) return dbFailed(error)
  revalidatePath('/vendor/profile')
  return done('Opening hours saved.')
}

export async function setClosedAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return
  const v = await vendorId(fd)
  if (!v) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('vendor_set_temporarily_closed', { p_vendor: v, p_closed: fd.get('closed') === '1' })
  revalidatePath('/vendor/profile')
  revalidatePath('/vendor')
  redirect('/vendor/profile')
}

export async function addStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  if (!v) return failed('Vendor not found.')
  const email = z.email().safeParse(text(fd, 'email', 254))
  if (!email.success) return failed('Enter a valid email address.')
  if (!(await rateLimit(`staff:${g.who.userId}`, 3600, 20)))
    return failed('Too many attempts. Please try later.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_add_staff', { p_vendor: v, p_email: email.data })
  if (error) return dbFailed(error)
  revalidatePath('/vendor/profile')
  // Same answer whether or not the person has an account (no account lookup oracle).
  return done('If that person has an AFIT Market account, they now have staff access.')
}

export async function removeStaffAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return
  const v = await vendorId(fd)
  const u = String(fd.get('userId') ?? '')
  if (!v || !uuid.safeParse(u).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('vendor_remove_staff', { p_vendor: v, p_user: u })
  revalidatePath('/vendor/profile')
  redirect('/vendor/profile')
}

export async function saveProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  if (!v) return failed('Vendor not found.')
  const price = nairaToKobo(text(fd, 'price', 20))
  if (price === null || price < 1)
    return failed('Enter a price in naira, for example 1500 or 1500.50.')
  const stockRaw = text(fd, 'stock', 8)
  let stock: number | null = null
  if (stockRaw !== '') {
    stock = /^\d{1,6}$/.test(stockRaw) ? Number(stockRaw) : NaN
    if (Number.isNaN(stock)) return failed('Stock must be a whole number, or empty for unlimited.')
  }
  const groups = parseOptionGroups(text(fd, 'options', 20000))
  if ('error' in groups) return failed(groups.error)
  const rawId = text(fd, 'productId', 40)
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('product_upsert', {
    p_vendor: v,
    p_product: uuid.safeParse(rawId).success ? rawId : null,
    p_name: text(fd, 'name', 80),
    p_description: text(fd, 'description', 300),
    p_price: price,
    p_section: text(fd, 'section', 40),
    p_available: fd.get('available') === 'on',
    p_stock: stock,
    p_options: groups.groups,
  })
  if (error) return dbFailed(error, 'Check the name (2-80 characters) and price.')
  const productId = uuid.safeParse(rawId).success ? rawId : String(data)
  // the photo (already shrunk in the browser) is kept with the product; a failure here never loses the product itself
  let photo: 'none' | 'saved' | 'removed' | 'failed' = 'none'
  const imageUrl = String(fd.get('image') ?? '')
  if (imageUrl) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageUrl)
    const buf = m ? Buffer.from(m[1]!, 'base64') : null
    if (!buf || buf.length < 500 || buf.length > 350_000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      photo = 'failed'
    } else {
      const r = await sb.rpc('vendor_set_product_image', {
        p_product: productId,
        p_jpeg: '\\x' + buf.toString('hex'),
      })
      photo = r.error ? 'failed' : 'saved'
    }
  } else if (String(fd.get('removeImage') ?? '') === '1') {
    const r = await sb.rpc('vendor_remove_product_image', { p_product: productId })
    photo = r.error ? 'failed' : 'removed'
  }
  revalidatePath('/vendor/catalogue')
  revalidatePath('/products')
  if (!rawId)
    redirect(`/vendor/catalogue/${productId}?created=1${photo === 'failed' ? '&photo=failed' : ''}`)
  if (photo === 'failed')
    return failed('The item was saved, but the photo could not be. Try another picture.')
  return done(photo === 'saved' ? 'Product and photo saved.' : 'Product saved.')
}

export async function toggleAvailabilityAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return
  const id = String(fd.get('productId') ?? '')
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('product_set_availability', {
    p_product: id,
    p_available: fd.get('available') === '1',
  })
  revalidatePath('/vendor/catalogue')
  redirect('/vendor/catalogue')
}

export async function archiveProductAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return
  const id = String(fd.get('productId') ?? '')
  if (!uuid.safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('product_archive', { p_product: id })
  revalidatePath('/vendor/catalogue')
  redirect('/vendor/catalogue')
}

// ---------------------------------------------------------------- add from the ready-made list
const MAX_PICKS = 20
const JPEG_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/

/**
 * "Add from the list": the shop ticks ready-made items for its category. An item with a price becomes a product now (with the
 * catalogue photo if the browser sent it); an item without a price is only remembered, so nothing without a real price is ever
 * shown to customers. Only items from the shop's own category list are accepted.
 */
export async function addFromListAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  if (!v) return failed('Vendor not found.')
  const slugs = [...new Set(fd.getAll('pick').map(String))]
  if (slugs.length === 0) return failed('Tick at least one item.')
  if (slugs.length > MAX_PICKS) return failed(`Add up to ${MAX_PICKS} items at a time.`)
  const sb = await createSupabaseServerClient()
  const { data: me } = await sb.rpc('my_vendor')
  const mine = me as { id?: string; category_slug?: string | null } | null
  if (!mine || mine.id !== v) return failed('Vendor not found.')
  const allowed = new Map(startersFor(mine.category_slug).map((i) => [i.slug, i]))
  let added = 0
  const later: string[] = []
  for (const slug of slugs) {
    const item = allowed.get(slug)
    if (!item || !STARTER_ITEMS.includes(item)) continue
    const price = nairaToKobo(text(fd, `price:${slug}`, 20))
    if (price === null || price < 1) {
      later.push(slug)
      continue
    }
    const { data, error } = await sb.rpc('product_upsert', {
      p_vendor: v,
      p_product: null,
      p_name: item.name,
      p_description: item.description,
      p_price: price,
      p_section: item.section,
      p_available: true,
      p_stock: null,
      p_options: [],
    })
    if (error) return dbFailed(error, `Could not add ${item.name}.`)
    added++
    const m = JPEG_URL.exec(String(fd.get(`image:${slug}`) ?? ''))
    const buf = m ? Buffer.from(m[1]!, 'base64') : null
    if (buf && buf.length >= 500 && buf.length <= 350_000 && buf[0] === 0xff && buf[1] === 0xd8)
      await sb.rpc('vendor_set_product_image', {
        p_product: String(data),
        p_jpeg: '\\x' + buf.toString('hex'),
      })
    await sb.rpc('vendor_picks_remove', { p_vendor: v, p_slug: slug })
  }
  if (later.length) await sb.rpc('vendor_picks_add', { p_vendor: v, p_slugs: later })
  revalidatePath('/vendor/catalogue')
  revalidatePath('/vendor/catalogue/quick-add')
  revalidatePath('/products')
  if (added === 0 && later.length === 0) return failed('Those items are not in your category list.')
  const parts = []
  if (added) parts.push(`${added} item${added === 1 ? '' : 's'} added to your menu`)
  if (later.length)
    parts.push(`${later.length} saved until you set a price (customers cannot see them yet)`)
  return done(parts.join('; ') + '.')
}

export async function forgetPickAction(fd: FormData): Promise<void> {
  const g = await gate(asReq(VENDOR))
  if ('state' in g) return
  const v = await vendorId(fd)
  const slug = String(fd.get('slug') ?? '')
  if (!v || !/^[a-z0-9-]{2,60}$/.test(slug)) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('vendor_picks_remove', { p_vendor: v, p_slug: slug })
  revalidatePath('/vendor/catalogue/quick-add')
}

// ---------------------------------------------------------------- what the shop sells (owner)
export async function saveShopCategoriesAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const g = await gate({ roles: ['vendor_owner'], aal: 'aal2' })
  if ('state' in g) return g.state
  const v = await vendorId(fd)
  const main = String(fd.get('main') ?? '')
  if (!v || !uuid.safeParse(main).success) return failed('Choose a main category.')
  const extra = [...new Set(fd.getAll('extra').map(String))].filter(
    (x) => uuid.safeParse(x).success && x !== main,
  )
  if (extra.length > 8) return failed('Choose up to 9 categories in all.')
  const other = text(fd, 'otherCategory', 60)
  if (other !== '' && other.length < 3)
    return failed('Say what else you sell in at least 3 letters.')
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_set_categories', {
    p_vendor: v,
    p_main: main,
    p_extra: extra,
    p_other: other || null,
  })
  if (error) return dbFailed(error, 'We could not save the categories.')
  revalidatePath('/vendor/profile')
  revalidatePath('/vendor/catalogue/quick-add')
  revalidatePath('/vendors')
  return done('Categories saved.')
}
