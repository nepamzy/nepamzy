import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/ui/icons'
import { Logo } from '@/components/ui/logo'

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'shield', title: 'Protected accounts', text: 'Your sign-in and payments are guarded.' },
  { icon: 'truck', title: 'Pickup or delivery', text: 'Choose how you get your order.' },
  { icon: 'card', title: 'Clear payments', text: 'See exactly what you pay and why.' },
]

/** Split layout for sign-in, registration, password reset and authenticator pages: brand panel on the left (hidden on phones), form on the right. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-10 text-white lg:flex lg:flex-col">
        <Logo tone="light" />
        <div className="my-auto max-w-md">
          <h2 className="text-4xl font-extrabold tracking-tight">
            Shop. Sell. <span className="text-gold-400">Deliver.</span>
          </h2>
          <p className="mt-3 text-lg text-navy-text">
            One campus marketplace for customers, shops and riders.
          </p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-800 text-gold-400">
                  <Icon name={p.icon} />
                </span>
                <span>
                  <span className="block font-bold">{p.title}</span>
                  <span className="text-sm text-navy-text">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span
          aria-hidden="true"
          className="absolute -bottom-24 -right-24 size-80 rounded-full border-[28px] border-gold-400/25"
        />
        <p className="text-xs text-navy-text">
          Pre-launch preview. Provisional design, not official AFIT branding.
        </p>
      </aside>
      <main id="main" className="flex flex-col justify-center bg-surface px-4 py-8 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <Logo className="mb-6 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  )
}
