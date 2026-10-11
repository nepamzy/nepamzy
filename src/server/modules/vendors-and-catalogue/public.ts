import 'server-only'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { clientIp, rateLimit } from '@/server/modules/identity-and-access/security'
import type { Category, Menu, ProductHit, VendorCard } from './types'

export const PAGE_SIZE = 12

/** Query-string filters for browsing. Everything is validated; unknown values fall back to safe defaults. */
const filterSchema = z.object({
  q: z.string().trim().max(60).catch('').default(''),
  category: z
    .string()
    .regex(/^[a-z0-9-]{2,40}$/)
    .optional()
    .catch(undefined),
  open: z.enum(['1']).optional().catch(undefined),
  max: z.coerce.number().int().min(1).max(100000000).optional().catch(undefined), // kobo
  page: z.coerce.number().int().min(1).max(200).catch(1).default(1),
})
export type BrowseFilters = z.infer<typeof filterSchema>
export const parseFilters = (sp: Record<string, string | string[] | undefined>): BrowseFilters =>
  filterSchema.parse(
    Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
  )

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc(fn, args)
  if (error) {
    logger.error('public rpc failed', { fn, code: error.code })
    return null
  }
  return data as T
}

export const listCategories = async () => (await rpc<Category[]>('list_categories', {})) ?? []

/** Throttles anonymous searching per IP. Returns false when over the limit (or the limiter is down). */
export async function allowSearch(): Promise<boolean> {
  return rateLimit(`search:ip:${await clientIp()}`, 60, 60)
}

export async function browseVendors(f: BrowseFilters): Promise<VendorCard[] | null> {
  return rpc<VendorCard[]>('browse_vendors', {
    p_q: f.q || null,
    p_category: f.category ?? null,
    p_open_only: f.open === '1',
    p_limit: PAGE_SIZE + 1,
    p_offset: (f.page - 1) * PAGE_SIZE, // one extra row tells us whether a next page exists
  })
}
export async function searchProducts(f: BrowseFilters): Promise<ProductHit[] | null> {
  if (!f.q) return []
  return rpc<ProductHit[]>('search_products', {
    p_q: f.q,
    p_max_price: f.max ?? null,
    p_open_only: f.open === '1',
    p_limit: PAGE_SIZE + 1,
    p_offset: (f.page - 1) * PAGE_SIZE,
  })
}
export const getMenu = (slug: string) =>
  /^[a-z0-9-]{2,60}$/.test(slug)
    ? rpc<Menu | null>('get_vendor_menu', { p_slug: slug })
    : Promise.resolve(null)
export async function getProduct(id: string) {
  if (!z.uuid().safeParse(id).success) return null
  return rpc<{ vendor: Menu['vendor']; product: Menu['products'][number] } | null>('get_product', {
    p_product: id,
  })
}
