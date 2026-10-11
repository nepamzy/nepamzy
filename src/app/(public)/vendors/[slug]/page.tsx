import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { WEEKDAYS, hoursByDay } from '@/server/modules/vendors-and-catalogue/hours'
import { getMenu } from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Vendor' }

export default async function VendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const menu = await getMenu((await params).slug)
  if (!menu) notFound()
  const { vendor, products, hours } = menu
  const bySection = new Map<string, typeof products>()
  for (const p of products)
    bySection.set(p.section ?? 'Menu', [...(bySection.get(p.section ?? 'Menu') ?? []), p])
  const byDay = hoursByDay(hours)
  return (
    <>
      <p className="mb-2">
        <Link href="/vendors" className="font-semibold text-brand-700 underline">
          ← All vendors
        </Link>
      </p>
      <PageHeader
        title={vendor.name}
        subtitle={[vendor.category, `Ready in about ${vendor.prep_minutes} min`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Badge tone={vendor.open_now ? 'success' : 'neutral'}>
            {vendor.open_now ? 'Open now' : 'Closed now'}
          </Badge>
        }
      />
      {vendor.description && <p className="mb-4">{vendor.description}</p>}
      {!vendor.open_now && (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius-control)] bg-warning-50 px-3 py-2 font-medium text-warning-700"
        >
          {vendor.temporarily_closed
            ? 'This vendor has paused orders for now.'
            : 'This vendor is closed at the moment. You can browse, but orders open when it reopens.'}
        </p>
      )}
      {products.length === 0 ? (
        <Card>
          <p className="text-muted">This vendor has not added any items yet.</p>
        </Card>
      ) : (
        [...bySection.entries()].map(([section, items]) => (
          <section key={section} className="mb-6" aria-labelledby={`s-${section}`}>
            <h2 id={`s-${section}`} className="mb-2 text-xl font-bold">
              {section}
            </h2>
            <ul className="space-y-2">
              {items.map((p) => (
                <li key={p.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-3">
                    <div className="min-w-0">
                      <Link href={`/products/${p.id}`} className="font-semibold hover:underline">
                        {p.name}
                      </Link>
                      {p.description && <p className="text-sm text-muted">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <Money kobo={p.price_kobo} className="font-semibold" />
                      {p.available ? (
                        <Link
                          href={`/products/${p.id}`}
                          className="touch-target inline-flex items-center rounded-[var(--radius-control)] border border-line-strong px-3 font-semibold hover:bg-brand-50"
                        >
                          Choose
                        </Link>
                      ) : (
                        <Badge>Sold out</Badge>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <section aria-labelledby="hours" className="mt-8">
        <h2 id="hours" className="mb-2 text-lg font-bold">
          Opening hours
        </h2>
        {hours.length === 0 ? (
          <p className="text-muted">Opening hours have not been set.</p>
        ) : (
          <dl className="grid max-w-sm grid-cols-[7rem_1fr] gap-y-1 text-sm">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="contents">
                <dt className="font-semibold">{d}</dt>
                <dd>{byDay[i]?.map((r) => `${r.from}–${r.to}`).join(', ') ?? 'Closed'}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-xs text-muted">Times are in Nigeria time (WAT).</p>
      </section>
    </>
  )
}
