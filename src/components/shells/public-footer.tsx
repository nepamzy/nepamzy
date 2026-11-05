import Link from 'next/link'
import { WhatsAppLogo } from '@/components/landing/whatsapp'
import { Logo } from '@/components/ui/logo'
import { WHATSAPP_NUMBER_DISPLAY, WHATSAPP_URL, supportEmail } from '@/lib/contact'

const COLS: { title: string; links: [string, string][] }[] = [
  {
    title: 'Shop',
    links: [
      ['Browse shops', '/vendors'],
      ['My cart', '/cart'],
      ['My orders', '/orders'],
    ],
  },
  {
    title: 'Account',
    links: [
      ['Sign in', '/login'],
      ['Create account', '/signup'],
      ['Forgot password', '/forgot-password'],
    ],
  },
  {
    title: 'Sell and deliver',
    links: [
      ['Open a shop', '/apply'],
      ['Become a rider', '/rider-apply'],
    ],
  },
  {
    title: 'Help',
    links: [
      ['Help and FAQ', '/faq'],
      ['Contact us', '/contact'],
      ['Report a problem', '/cases'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About', '/about'],
      ['Delivery', '/delivery'],
      ['Payments', '/payments'],
      ['Refunds and returns', '/refunds'],
      ['Terms summary', '/terms'],
      ['Privacy summary', '/privacy'],
    ],
  },
]

export function PublicFooter() {
  return (
    <footer className="mt-12 bg-navy-900 text-navy-text">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_repeat(5,1fr)]">
        <div>
          <Logo tone="light" />
          <p className="mt-3 max-w-xs text-sm">
            Shop, sell and deliver on one campus marketplace. Orders and payments are protected by
            your account.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-2 font-semibold text-white hover:underline"
              >
                <WhatsAppLogo size={24} /> WhatsApp {WHATSAPP_NUMBER_DISPLAY}
              </a>
            </li>
            {supportEmail() && (
              <li>
                <a
                  className="font-semibold text-white hover:underline"
                  href={`mailto:${supportEmail()}`}
                >
                  {supportEmail()}
                </a>
              </li>
            )}
          </ul>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-white">
              {c.title}
            </h2>
            <ul className="space-y-1">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-8 items-center text-sm hover:text-white hover:underline"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs">
          Pre-launch preview. AFIT Market uses its own provisional colours and mark; it is not
          official AFIT branding.
        </p>
      </div>
    </footer>
  )
}
