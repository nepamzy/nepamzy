'use client'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'
import { CustomerArt, RiderArt, VendorArt } from './illustrations'

const ROLES = [
  {
    id: 'customer',
    label: 'I want to order',
    icon: 'bag' as IconName,
    art: CustomerArt,
    title: 'Order from campus shops',
    lead: 'Food, printing and everyday items from approved shops, collected or brought to you.',
    points: [
      'Browse by category or search for exactly what you want.',
      'Pay with Paystack. Prices are checked again at checkout.',
      'Choose pick-up, or an approved delivery point.',
      'Watch your rider on a live map and confirm on arrival.',
    ],
    cta: { href: '/signup', label: 'Create a customer account' },
    where: 'Customers',
  },
  {
    id: 'vendor',
    label: 'I run a shop',
    icon: 'store' as IconName,
    art: VendorArt,
    title: 'Sell to the whole campus',
    lead: 'Put your menu online, take paid orders and hand them to a rider when they are ready.',
    points: [
      'Apply once. An administrator reviews every shop before it opens.',
      'Add items with photos, prices and options.',
      'Accept, prepare and hand over with a simple code.',
      'See your earnings and add a verified payout account.',
    ],
    cta: { href: '/apply', label: 'Open a shop' },
    where: 'Shops',
  },
  {
    id: 'rider',
    label: 'I want to deliver',
    icon: 'bike' as IconName,
    art: RiderArt,
    title: 'Deliver and earn',
    lead: 'Take nearby deliveries, follow the route on the map and finish each one at the door.',
    points: [
      'Riders are approved before taking any delivery.',
      'Collect from the shop with a one-time handover code.',
      'The customer sees you on the map as you ride.',
      'At the door: the customer signs on your phone, or scans your QR code.',
    ],
    cta: { href: '/rider-apply', label: 'Become a rider' },
    where: 'Riders',
  },
] as const

/** Three people, three tabs. Arrow keys move between them. */
export function RoleTabs() {
  const [i, setI] = useState(0)
  const uid = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const role = ROLES[i]!
  const Art = role.art
  const move = (to: number) => {
    const n = (to + ROLES.length) % ROLES.length
    setI(n)
    refs.current[n]?.focus()
  }
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]">
      <div
        role="tablist"
        aria-label="Who is AFIT Market for?"
        className="grid grid-cols-3 border-b border-line bg-surface"
      >
        {ROLES.map((r, n) => (
          <button
            key={r.id}
            ref={(el) => {
              refs.current[n] = el
            }}
            role="tab"
            type="button"
            id={`${uid}-tab-${r.id}`}
            aria-selected={i === n}
            aria-controls={`${uid}-panel`}
            tabIndex={i === n ? 0 : -1}
            onClick={() => setI(n)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(n + 1)
              else if (e.key === 'ArrowLeft') move(n - 1)
              else if (e.key === 'Home') move(0)
              else if (e.key === 'End') move(ROLES.length - 1)
            }}
            className={cn(
              'touch-target flex flex-col items-center justify-center gap-1 px-2 py-3 text-center text-sm font-bold transition sm:flex-row sm:gap-2 sm:text-base',
              i === n
                ? 'bg-card text-navy-900 shadow-[inset_0_-4px_0_var(--color-gold-400)]'
                : 'text-muted hover:bg-brand-50 hover:text-navy-900',
            )}
          >
            <Icon name={r.icon} size={22} />
            <span>{r.label}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-tab-${role.id}`}
        className="grid items-center gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] md:p-8"
      >
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-700">{role.where}</p>
          <h3 className="mt-1 text-2xl font-extrabold text-navy-900 sm:text-3xl">{role.title}</h3>
          <p className="mt-2 text-lg text-muted">{role.lead}</p>
          <ul className="mt-4 space-y-2">
            {role.points.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-success-700" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <Link
            href={role.cta.href}
            className="touch-target mt-5 inline-flex items-center justify-center rounded-[var(--radius-control)] bg-gold-400 px-5 font-bold text-ink shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:brightness-95"
          >
            {role.cta.label} →
          </Link>
        </div>
        <div className="mx-auto w-full max-w-xs">
          <Art className="afit-float-slow h-auto w-full" />
        </div>
      </div>
    </div>
  )
}
