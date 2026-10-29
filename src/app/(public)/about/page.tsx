import type { Metadata } from 'next'
import { InfoPage } from '@/components/shells/info-page'
import { ButtonLink } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'About' }

const VALUES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'shield',
    title: 'Trust',
    text: 'Shops and riders are approved by an administrator before they can work.',
  },
  {
    icon: 'receipt',
    title: 'Clarity',
    text: 'Prices, fees and receipts are shown plainly and checked on the server.',
  },
  {
    icon: 'users',
    title: 'Community',
    text: 'Built for campus shops, customers and riders to do business together.',
  },
]

export default function About() {
  return (
    <InfoPage
      title="About AFIT Market"
      intro="One place to order food, printing and everyday items from campus shops, for pickup or delivery."
    >
      <section>
        <h2>What it is</h2>
        <p>
          AFIT Market is a marketplace for customers, shops and delivery riders. Customers browse
          items, pay online and either collect their order or have it delivered to an approved
          delivery point. Shops manage their own items and orders. Riders take approved deliveries.
        </p>
      </section>
      <ul className="grid gap-4 sm:grid-cols-3">
        {VALUES.map((v) => (
          <li
            key={v.title}
            className="rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)]"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={v.icon} />
            </span>
            <h3 className="mt-2 font-extrabold text-navy-900">{v.title}</h3>
            <p className="text-sm text-muted">{v.text}</p>
          </li>
        ))}
      </ul>
      <section>
        <h2>Where things stand</h2>
        <p>
          AFIT Market is a pre-launch preview. Payments run in Paystack test mode, so no real money
          moves. It is not yet an official AFIT service and uses its own provisional colours and
          mark.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/products" variant="gold">
          Start shopping
        </ButtonLink>
        <ButtonLink href="/contact" variant="secondary">
          Contact us
        </ButtonLink>
      </div>
    </InfoPage>
  )
}
