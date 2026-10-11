import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AddToCartForm } from '@/components/domain/add-to-cart-form'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { getProduct } from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Item' }

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await getProduct((await params).id)
  if (!found) notFound()
  const { vendor, product } = found
  return (
    <>
      <p className="mb-2"><Link href={`/vendors/${vendor.slug}`} className="font-semibold text-brand-700 underline">← {vendor.name}</Link></p>
      <PageHeader title={product.name} subtitle={vendor.name} actions={<Badge tone={vendor.open_now ? 'success' : 'neutral'}>{vendor.open_now ? 'Open now' : 'Closed now'}</Badge>} />
      <Card className="max-w-xl space-y-4">
        {product.description && <p>{product.description}</p>}
        <p className="text-xl font-bold"><Money kobo={product.price_kobo} /></p>
        {!product.available && <p role="status" className="font-semibold text-danger-700">Sold out</p>}
        {!vendor.open_now && <p role="status" className="text-sm text-warning-700">The vendor is closed now. You can add this to your cart, but checkout opens when it reopens.</p>}
        <AddToCartForm product={product} orderable={product.available} />
        <p className="text-xs text-muted">Prices are checked again at checkout. You will confirm your authenticator code before paying.</p>
      </Card>
    </>
  )
}
