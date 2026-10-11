import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button, ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { EmptyState } from '@/components/ui/states'
import { archiveProductAction, toggleAvailabilityAction } from '@/server/modules/vendors-and-catalogue/actions'
import { getMyVendor, listProducts } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Catalogue' }

export default async function Catalogue() {
  const vendor = await getMyVendor()
  if (!vendor) return <EmptyState title="No vendor account yet" />
  const products = await listProducts(vendor.id)
  return (
    <>
      <PageHeader title="Catalogue" subtitle="Your menu as customers see it" actions={vendor.status === 'approved' ? <ButtonLink href="/vendor/catalogue/new">Add an item</ButtonLink> : undefined} />
      {products.length === 0 ? <EmptyState title="Your menu is empty" action={<ButtonLink href="/vendor/catalogue/new">Add your first item</ButtonLink>}>Customers can only see items you add here.</EmptyState> : (
        <ul className="space-y-3">
          {products.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/vendor/catalogue/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                  <p className="text-sm text-muted">{[p.section, p.stock_quantity === null ? 'Unlimited stock' : `${p.stock_quantity} in stock`].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Money kobo={p.price_kobo} className="font-semibold" />
                  <Badge tone={p.is_available && p.stock_quantity !== 0 ? 'success' : 'neutral'}>{p.is_available && p.stock_quantity !== 0 ? 'On sale' : 'Sold out'}</Badge>
                  <form action={toggleAvailabilityAction}><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="available" value={p.is_available ? '0' : '1'} />
                    <Button type="submit" variant="secondary" disabled={vendor.status !== 'approved'}>{p.is_available ? 'Mark sold out' : 'Put back on sale'}</Button></form>
                  <form action={archiveProductAction}><input type="hidden" name="productId" value={p.id} />
                    <Button type="submit" variant="ghost" disabled={vendor.status !== 'approved'} aria-label={`Remove ${p.name} from menu`}>Remove</Button></form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
