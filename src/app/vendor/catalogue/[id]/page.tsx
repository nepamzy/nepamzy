import { createSupabaseServiceClient } from '@/lib/supabase/service'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProductForm } from '@/components/domain/product-form'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import {
  getEditableProduct,
  getMyVendor,
} from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Edit item' }
export default async function EditProduct({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string; photo?: string }>
}) {
  const vendor = await getMyVendor()
  if (!vendor) return <EmptyState title="No vendor account yet" />
  const product = await getEditableProduct(vendor.id, (await params).id)
  if (!product) notFound()
  const sp = await searchParams
  // the product belongs to this shop (checked above), so reading its photo flag with the service role is safe
  const { data: photoRow } = await createSupabaseServiceClient()
    .from('product_images')
    .select('product_id')
    .eq('product_id', product.id)
    .maybeSingle()
  const created = sp.created
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Shop', href: '/vendor' },
          { label: 'Catalogue', href: '/vendor/catalogue' },
          { label: product.name },
        ]}
        title={product.name}
        subtitle="Edit the item, its photo, price and options."
      />
      {created && (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          Item added to your menu.
        </p>
      )}
      {sp.photo === 'failed' && (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          The item was added, but its photo could not be saved. Add the photo again below.
        </p>
      )}
      <Card className="max-w-2xl">
        <ProductForm
          vendorId={vendor.id}
          product={product}
          disabled={vendor.status !== 'approved'}
          hasPhoto={Boolean(photoRow)}
        />
      </Card>
    </>
  )
}
