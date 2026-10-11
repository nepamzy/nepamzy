import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProductForm } from '@/components/domain/product-form'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { getEditableProduct, getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Edit item' }
export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const vendor = await getMyVendor()
  if (!vendor) return <EmptyState title="No vendor account yet" />
  const product = await getEditableProduct(vendor.id, (await params).id)
  if (!product) notFound()
  const created = (await searchParams).created
  return (
    <>
      <PageHeader title={product.name} subtitle="Edit item" />
      {created && <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700">Item added to your menu.</p>}
      <Card className="max-w-2xl"><ProductForm vendorId={vendor.id} product={product} disabled={vendor.status !== 'approved'} /></Card>
    </>
  )
}
