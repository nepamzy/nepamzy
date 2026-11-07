import type { Metadata } from 'next'
import { QuickAdd } from '@/components/domain/quick-add'
import { forgetPickAction } from '@/server/modules/vendors-and-catalogue/actions'
import { PageHeader } from '@/components/ui/card'
import { Card } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { startersFor } from '@/lib/starter-catalogue'
import { getMyVendor, listProducts } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Add from the list' }

export default async function QuickAddPage() {
  const vendor = await getMyVendor()
  if (!vendor || vendor.status !== 'approved')
    return <EmptyState title="You cannot add items right now" />
  const items = startersFor(
    vendor.category_slugs?.length ? vendor.category_slugs : vendor.category_slug,
  )
  const sb = await createSupabaseServerClient()
  const [{ data: picks }, products, { data: cats }] = await Promise.all([
    sb.rpc('vendor_picks_list', { p_vendor: vendor.id }),
    listProducts(vendor.id),
    sb
      .from('categories')
      .select('slug,name,sort_order')
      .in(
        'slug',
        vendor.category_slugs?.length ? vendor.category_slugs : [vendor.category_slug ?? ''],
      )
      .order('sort_order'),
  ])
  const waiting = ((picks as string[] | null) ?? []).filter((s) => items.some((i) => i.slug === s))
  const names = ((cats ?? []) as { name: string }[]).map((c) => c.name)
  const categoryName = names.length ? names.join(', ') : 'your category'
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Shop', href: '/vendor' },
          { label: 'Catalogue', href: '/vendor/catalogue' },
          { label: 'Add from the list' },
        ]}
        title="Add from the list"
        subtitle="Pick the items you sell. The picture and description are filled in for you."
        actions={
          <ButtonLink href="/vendor/catalogue/new" variant="secondary">
            Add my own item
          </ButtonLink>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="No ready-made list for your category yet"
          action={<ButtonLink href="/vendor/catalogue/new">Add your own item</ButtonLink>}
        >
          We are still adding ready-made items for {categoryName}. You can add your own items now.
        </EmptyState>
      ) : (
        <>
          {waiting.length > 0 && (
            <Card className="mb-4">
              <h2 className="text-lg font-extrabold text-navy-900">Saved, waiting for a price</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {waiting.map((slug) => {
                  const it = items.find((i) => i.slug === slug)!
                  return (
                    <li key={slug}>
                      <form
                        action={forgetPickAction}
                        className="flex items-center gap-2 rounded-full bg-brand-50 py-1 pl-3 pr-1"
                      >
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <span className="text-sm font-semibold">{it.name}</span>
                        <Button
                          type="submit"
                          variant="ghost"
                          className="min-h-8 px-2 py-1 text-sm"
                          aria-label={`Forget ${it.name}`}
                        >
                          Forget
                        </Button>
                      </form>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-sm text-muted">
                Tick them below and add a price to put them on your menu.
              </p>
            </Card>
          )}
          <QuickAdd
            vendorId={vendor.id}
            items={items}
            onMenu={products.filter((p) => p.status === 'active').map((p) => p.name.toLowerCase())}
            waiting={waiting}
            categoryName={categoryName}
          />
        </>
      )}
    </>
  )
}
