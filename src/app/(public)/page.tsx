import Link from 'next/link'
import { VendorCardView } from '@/components/domain/vendor-card'
import { ButtonLink } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icons'
import { ProductCard, categoryIcon } from '@/components/ui/product-card'
import { SearchField } from '@/components/ui/search-field'
import { Section } from '@/components/ui/section'
import { EmptyState } from '@/components/ui/states'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { cartItemCount } from '@/server/modules/cart-and-checkout/queries'
import { listOrdersPage } from '@/server/modules/orders-and-state-machine/queries'
import {
  browseProducts,
  browseVendors,
  listCategories,
  parseFilters,
} from '@/server/modules/vendors-and-catalogue/public'

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'search',
    title: 'Find what you need',
    text: 'Browse shops and items, or search by name.',
  },
  {
    icon: 'card',
    title: 'Pay securely',
    text: 'Prices are checked again at checkout, then you pay with Paystack.',
  },
  {
    icon: 'truck',
    title: 'Pick up or get it delivered',
    text: 'Collect from the shop, or choose an approved delivery point.',
  },
]
const TRUST: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'shield',
    title: 'Protected accounts',
    text: 'Optional two-step sign-in for extra safety.',
  },
  { icon: 'receipt', title: 'Clear receipts', text: 'See what you paid and why.' },
  { icon: 'help', title: 'Help when it goes wrong', text: 'Report a problem on any order.' },
]

export default async function Home() {
  const who = await loadPrincipal()
  const signedInCustomer = who.authenticated && who.roles.includes('customer')
  const [active, cartCount] = signedInCustomer
    ? await Promise.all([listOrdersPage({ finished: false, pageSize: 20 }), cartItemCount()])
    : [null, 0]
  const [cats, products, vendors] = await Promise.all([
    listCategories(),
    browseProducts(parseFilters({}), 8),
    browseVendors({ ...parseFilters({}), open: '1' }),
  ])
  return (
    <div className="space-y-10">
      {active && (
        <section aria-label="Your activity" className="grid gap-3 sm:grid-cols-3">
          {[
            {
              href: '/orders?view=active',
              icon: 'package' as IconName,
              title: 'Orders in progress',
              value: String(active.orders.length) + (active.hasMore ? '+' : ''),
            },
            {
              href: '/cart',
              icon: 'cart' as IconName,
              title: 'Items in your cart',
              value: String(cartCount),
            },
            {
              href: '/account/wishlist',
              icon: 'heart' as IconName,
              title: 'Your wishlist',
              value: 'Open',
            },
          ].map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)]"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={s.icon} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-muted">{s.title}</span>
                <span className="block text-xl font-extrabold text-navy-900">{s.value}</span>
              </span>
            </Link>
          ))}
        </section>
      )}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 px-5 py-10 text-white sm:px-10 sm:py-14">
        <div className="relative z-10 max-w-xl">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-gold-400">
            <Icon name="store" size={16} /> Campus marketplace
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Everything you need, <span className="text-gold-400">one tap away.</span>
          </h1>
          <p className="mt-4 text-lg text-navy-text">
            Order food, printing and everyday items from campus shops. Collect it yourself or have
            it delivered.
          </p>
          <SearchField
            action="/products"
            placeholder="Search food, printing, items…"
            label="Search items"
            className="mt-6 max-w-lg text-ink"
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/products" variant="gold">
              Shop now
            </ButtonLink>
            <ButtonLink href="/vendors" variant="secondary">
              Browse shops
            </ButtonLink>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 hidden -translate-y-1/2 gap-4 md:flex"
        >
          {(['utensils', 'printer', 'bag'] as IconName[]).map((n, i) => (
            <span
              key={n}
              className={`grid size-32 place-items-center rounded-3xl text-gold-400 ${i === 1 ? 'mt-16 bg-navy-700' : 'bg-navy-800'}`}
            >
              <Icon name={n} size={56} />
            </span>
          ))}
        </div>
        <span aria-hidden="true" className="absolute -bottom-6 left-0 h-3 w-1/3 bg-gold-400" />
      </section>

      {cats.length > 0 && (
        <Section
          title="Shop by category"
          id="cats"
          actions={
            <Link href="/products" className="font-bold text-brand-700 hover:underline">
              All items →
            </Link>
          }
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/products?category=${c.slug}`}
                  className="flex h-full flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-card p-4 text-center font-bold text-navy-900 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                    <Icon name={categoryIcon(c.slug)} size={26} />
                  </span>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Featured items"
        id="featured"
        description="From shops that are open now, then the rest."
        actions={
          <Link href="/products" className="font-bold text-brand-700 hover:underline">
            View all →
          </Link>
        }
      >
        {products && products.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {products.slice(0, 8).map((p) => (
              <li key={p.id}>
                <ProductCard
                  href={`/products/${p.id}`}
                  name={p.name}
                  vendorName={p.vendor_name}
                  priceKobo={p.price_kobo}
                  available={p.available}
                  openNow={p.open_now}
                  icon={categoryIcon(p.category_slug)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No items yet" icon="package">
            Items appear here as soon as approved shops add them.
          </EmptyState>
        )}
      </Section>

      <Section
        title="Shops open now"
        id="shops"
        actions={
          <Link href="/vendors" className="font-bold text-brand-700 hover:underline">
            All shops →
          </Link>
        }
      >
        {vendors && vendors.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.slice(0, 3).map((v) => (
              <li key={v.id}>
                <VendorCardView v={v} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No shops are open right now" icon="store">
            Check back later, or browse every shop to see opening hours.
          </EmptyState>
        )}
      </Section>

      <Section title="How it works" id="how">
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-gold-400">
                <Icon name={s.icon} size={22} />
              </span>
              <span>
                <span className="block text-sm font-bold text-muted">Step {i + 1}</span>
                <span className="block font-extrabold text-navy-900">{s.title}</span>
                <span className="text-sm text-muted">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[var(--radius-card)] bg-navy-900 p-6 text-white">
          <Icon name="store" size={28} className="text-gold-400" />
          <h2 className="mt-2 text-2xl font-extrabold">Sell on AFIT Market</h2>
          <p className="mt-1 text-navy-text">
            Apply to open a shop. An administrator reviews every application.
          </p>
          <ButtonLink href="/apply" variant="gold" className="mt-4">
            Open a shop
          </ButtonLink>
        </div>
        <div className="rounded-[var(--radius-card)] bg-gold-400 p-6 text-ink">
          <Icon name="bike" size={28} />
          <h2 className="mt-2 text-2xl font-extrabold">Deliver and earn</h2>
          <p className="mt-1">
            Apply to become a rider. Riders are approved before taking deliveries.
          </p>
          <ButtonLink href="/rider-apply" className="mt-4">
            Become a rider
          </ButtonLink>
        </div>
      </section>

      <ul className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)] md:grid-cols-3">
        {TRUST.map((t) => (
          <li key={t.title} className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={t.icon} />
            </span>
            <span>
              <span className="block font-bold text-navy-900">{t.title}</span>
              <span className="text-sm text-muted">{t.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
