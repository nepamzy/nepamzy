import type { Metadata } from 'next'
import { ProductForm } from '@/components/domain/product-form'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { getMyVendor } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Add an item' }
export default async function NewProduct() {
  const vendor = await getMyVendor()
  if (!vendor || vendor.status !== 'approved')
    return <EmptyState title="You cannot add items right now" />
  return (
    <>
      <PageHeader title="Add an item" />
      <Card className="max-w-2xl">
        <ProductForm vendorId={vendor.id} />
      </Card>
    </>
  )
}
