import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { clientIp, rateLimit } from '@/server/modules/identity-and-access/security'

import { artKind, productArtSvg, type ArtKind } from '@/lib/art/scenes'

const placeholder = (kind: ArtKind = 'general') =>
  new NextResponse(productArtSvg(kind), {
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
  if (!data || !p || p.status !== 'active' || p.vendors.status !== 'approved') {
    // no photo: draw a picture that suits the product, chosen from its name and its shop's category
    const { data: prod } = await sb
      .from('products')
      .select('name, status, vendors!inner(status, categories(slug))')
      .eq('id', id)
      .maybeSingle()
    const v = prod?.vendors as unknown as
      { status: string; categories?: { slug: string } | null } | undefined
    if (!prod || prod.status !== 'active' || v?.status !== 'approved') return placeholder()
    return placeholder(artKind(prod.name, v.categories?.slug))
  }
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
