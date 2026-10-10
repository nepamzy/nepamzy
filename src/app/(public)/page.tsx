import { ButtonLink } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-[var(--radius-card)] bg-brand-800 px-5 py-10 text-white sm:px-10">
        <h1 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">Campus food and shops, one tap away.</h1>
        <p className="mt-3 max-w-xl text-lg text-brand-100">Order from approved AFIT community vendors. Collect it yourself or have it delivered.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/vendors" variant="secondary">Browse vendors</ButtonLink>
          <ButtonLink href="/signup" className="bg-accent-600 hover:bg-accent-700">Create account</ButtonLink>
        </div>
      </section>
      <section aria-labelledby="how" className="grid gap-4 sm:grid-cols-3">
        <h2 id="how" className="sr-only">How it works</h2>
        {[
          ['1. Pick a vendor', 'Browse approved vendors and see prices before you sign up.'],
          ['2. Order and pay', 'Choose pickup or delivery. A second sign-in step keeps your account safe.'],
          ['3. Confirm receipt', 'Sign on handover so everyone has a clear record.'],
        ].map(([t, d]) => (
          <Card key={t}><h3 className="font-bold">{t}</h3><p className="mt-1 text-muted">{d}</p></Card>
        ))}
      </section>
      <p className="text-center text-sm text-muted">AFIT Market is in early development. Ordering is not open yet.</p>
    </div>
  )
}
