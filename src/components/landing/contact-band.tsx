import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { supportEmail } from '@/lib/contact'
import { WhatsAppLink } from './whatsapp'

/** "Talk to us": WhatsApp first (the number is real), then e-mail when one is set, then the contact form. */
export function ContactBand() {
  const email = supportEmail()
  return (
    <section
      aria-labelledby="talk-h"
      className="grid items-center gap-5 rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-[var(--shadow-card)] md:grid-cols-[minmax(0,1fr)_auto] md:p-8"
    >
      <div>
        <h2 id="talk-h" className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
          Talk to a real person
        </h2>
        <p className="mt-1 text-muted">
          Questions about orders, opening a shop or becoming a rider? Message us and we will help.
        </p>
        <ul className="mt-4 space-y-2">
          {email && (
            <li className="flex items-center gap-2">
              <Icon name="mail" className="text-brand-700" />
              <a className="font-semibold text-brand-700 underline" href={`mailto:${email}`}>
                {email}
              </a>
            </li>
          )}
          <li className="flex items-center gap-2">
            <Icon name="help" className="text-brand-700" />
            <Link className="font-semibold text-brand-700 underline" href="/contact">
              Send a message from the contact page
            </Link>
          </li>
        </ul>
      </div>
      <WhatsAppLink className="justify-self-start md:justify-self-end" />
    </section>
  )
}
