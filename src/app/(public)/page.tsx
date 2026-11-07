import Link from 'next/link'
import { VendorCardView } from '@/components/domain/vendor-card'
import { ContactBand } from '@/components/landing/contact-band'
import { Faq } from '@/components/landing/faq'
import { HeroPhoto } from '@/components/landing/hero-photo'
import { OrderDemo } from '@/components/landing/order-demo'
import { Reveal } from '@/components/landing/reveal'
import { RoleTabs } from '@/components/landing/role-tabs'
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

const WHY: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'card',
    title: 'Secure payments',
    text: 'You pay with Paystack. The shop is only told to start once your payment is confirmed.',
  },
  {
    icon: 'pin',
    title: 'A live map',
    text: 'Follow your rider as they come to you. They can see where to find you too.',
  },
  {
    icon: 'check-circle',
    title: 'Hand-over you can trust',
    text: 'At the door you sign on the rider’s phone, or scan their QR code. No forgotten confirmations.',
  },
  {
    icon: 'store',
    title: 'Approved shops and riders',
    text: 'Every shop and every rider is reviewed by an administrator before they start.',
  },
  {
    icon: 'receipt',
    title: 'Clear receipts',
    text: 'See exactly what you paid and why, with your delivery fee shown separately.',
  },
  {
    icon: 'help',
    title: 'Help when it goes wrong',
    text: 'Report a problem on any order and staff step in. Refunds and returns follow clear rules.',
  },
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
        <div className="relative z-10 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-gold-400">
              <Icon name="store" size={16} /> Campus marketplace
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Shop. Order. <span className="text-gold-400">Receive.</span>
            </h1>
            <p className="mt-4 text-lg text-navy-text">
              Order food, printing and everyday items from campus shops. Collect it yourself or have
              a rider bring it to you, and watch them arrive on a live map.
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
              <ButtonLink href="/signup" variant="secondary">
                Create an account
              </ButtonLink>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-navy-text">
              {['Pay securely with Paystack', 'Live rider map', 'Signature or QR hand-over'].map(
                (t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Icon name="check-circle" size={18} className="text-gold-400" />
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>
          <HeroPhoto className="w-full" />
        </div>
        <span aria-hidden="true" className="absolute -bottom-6 left-0 h-3 w-1/3 bg-gold-400" />
      </section>

      <Reveal>
        <Section
          title="Made for the three people on campus"
          id="who"
          description="Pick yours to see how AFIT Market works for you."
        >
          <RoleTabs />
        </Section>
      </Reveal>

      {cats.length > 0 && (
        <Section
          title="Shop by category"
          id="cats"
          actions={
            <Link href="/products" className="font-bold text-brand-700 hover:underline">
              View all →
            </Link>
          }
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cats.slice(0, 5).map((c) => (
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

      <Reveal>
        <OrderDemo />
      </Reveal>

      <Reveal>
        <Section title="Why people use AFIT Market" id="why">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.map((w) => (
              <li
                key={w.title}
                className="rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-pop)]"
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-navy-900 text-gold-400">
                  <Icon name={w.icon} size={24} />
                </span>
                <h3 className="mt-3 text-lg font-extrabold text-navy-900">{w.title}</h3>
                <p className="mt-1 text-muted">{w.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      </Reveal>

      <Reveal>
        <Section title="Questions people ask" id="faq">
          <Faq />
        </Section>
      </Reveal>

      <Reveal>
        <ContactBand />
      </Reveal>

      <Reveal>
        <section className="rounded-[var(--radius-card)] bg-gradient-to-r from-navy-900 to-navy-700 p-6 text-center text-white sm:p-10">
          <h2 className="text-3xl font-extrabold">Ready when you are</h2>
          <p className="mx-auto mt-2 max-w-xl text-navy-text">
            Create a free account in a minute. Customers, shops and riders all start the same way.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" variant="gold">
              Create an account
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
        </section>
      </Reveal>
    </div>
  )
}
