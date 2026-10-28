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
      <PageHeader
        breadcrumbs={[
          { label: 'Shop', href: '/vendor' },
          { label: 'Catalogue', href: '/vendor/catalogue' },
          { label: 'Add an item' },
        ]}
        title="Add an item"
        subtitle="Name, price and options. Photos are not available yet because file storage has not been set up."
      />
      <Card className="max-w-2xl">
        <ProductForm vendorId={vendor.id} />
      </Card>
    </>
  )
}
