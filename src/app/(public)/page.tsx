import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { VendorCardView } from '@/components/domain/vendor-card'
import { Input } from '@/components/ui/fields'
import { Button } from '@/components/ui/button'
import { browseVendors, listCategories, parseFilters } from '@/server/modules/vendors-and-catalogue/public'

export default async function Home() {
  const [cats, vendors] = await Promise.all([listCategories(), browseVendors({ ...parseFilters({}), open: '1' })])
  return (
    <div className="space-y-8">
      <section className="rounded-[var(--radius-card)] bg-brand-800 px-5 py-10 text-white sm:px-10">
        <h1 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">Campus food and shops, one tap away.</h1>
        <p className="mt-3 max-w-xl text-lg text-brand-100">Order from approved AFIT community vendors. Collect it yourself or have it delivered.</p>
        <form action="/vendors" role="search" className="mt-6 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 text-ink"><Input label="Search food, shops and services" name="q" placeholder="e.g. rice, printing" maxLength={60} /></div>
          <Button type="submit" className="bg-accent-600 hover:bg-accent-700">Search</Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {cats.map((c) => <Link key={c.id} href={`/vendors?category=${c.slug}`} className="touch-target inline-flex items-center rounded-full bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-600">{c.name}</Link>)}
        </div>
      </section>
      <section aria-labelledby="open-now">
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 id="open-now" className="text-xl font-bold">Open now</h2>
          <Link href="/vendors" className="font-semibold text-brand-700 underline">All vendors</Link>
        </div>
        {vendors === null ? <p className="text-muted">We could not load vendors right now. Please try again.</p>
          : vendors.length === 0 ? <p className="text-muted">No vendors are open right now.</p>
          : <ul className="grid gap-4 sm:grid-cols-2">{vendors.slice(0, 6).map((v) => <li key={v.id}><VendorCardView v={v} /></li>)}</ul>}
      </section>
      <p className="text-center text-sm text-muted">Browsing needs no account. You will set up a second sign-in step before you place an order.</p>
      <div className="flex justify-center"><ButtonLink href="/apply" variant="ghost">Sell on AFIT Market</ButtonLink></div>
    </div>
  )
}
