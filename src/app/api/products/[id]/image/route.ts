import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { clientIp, rateLimit } from '@/server/modules/identity-and-access/security'

/** The branded tile shown for a product without a photo: navy with a gold shopping bag. Same look as the in-page tile. */
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="No photo yet"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(11,42,92)"/><stop offset="1" stop-color="rgb(23,74,156)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><g fill="none" stroke="rgb(255,201,40)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M150 125h100l12 95h-124z"/><path d="M175 125v-18a25 25 0 0 1 50 0v18"/></g></svg>`

const placeholder = () =>
  new NextResponse(PLACEHOLDER, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'X-Afit-Photo': 'none',
    },
  })

/**
 * A product's photo. Public on purpose, like the catalogue itself: only photos of ACTIVE products of APPROVED shops are
 * served, and nothing else about the product. No photo (or a hidden product) gets the placeholder tile, so a missing
 * photo is never an error on the page and nothing reveals whether a hidden product exists.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success) return new NextResponse(null, { status: 404 })
  // generous (a page of cards loads many photos), but a single address cannot hammer the database
  if (!(await rateLimit(`photo:ip:${await clientIp()}`, 60, 600)))
    return new NextResponse(null, { status: 429 })
  const sb = createSupabaseServiceClient()
  const { data } = await sb
    .from('product_images')
    .select('jpeg, updated_at, products!inner(status, vendors!inner(status))')
    .eq('product_id', id)
    .maybeSingle()
  const p = data?.products as unknown as { status: string; vendors: { status: string } } | undefined
  if (!data || !p || p.status !== 'active' || p.vendors.status !== 'approved') return placeholder()
  const hex = String(data.jpeg).replace(/^\\x/, '')
  const body = Buffer.from(hex, 'hex')
  const etag = `"${new Date(data.updated_at).getTime()}"`
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
