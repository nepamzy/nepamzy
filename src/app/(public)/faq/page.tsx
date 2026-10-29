import type { Metadata } from 'next'
import Link from 'next/link'
import { InfoPage } from '@/components/shells/info-page'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'Help and FAQ' }

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do I place an order?',
    a: 'Find an item, choose any options, add it to your cart and go to checkout. Pick pickup or delivery, review the total and pay with Paystack. You need an account to order.',
  },
  {
    q: 'How do I pay?',
    a: 'Payment is online through Paystack. The total is calculated by the server and shown before you pay. Right now payments are in test mode, so no real money moves.',
  },
  {
    q: 'Do I have to use an authenticator app?',
    a: 'No. Two-step sign-in is optional for customers. You can switch it on from Account, then Security, if you want an extra lock on your account.',
  },
  {
    q: 'What if I forget my password?',
    a: 'On the sign-in page choose "Forgot your password?". We email a 6-digit code to the address on your account, and you choose a new password.',
  },
  {
    q: 'How does delivery work?',
    a: 'Delivery goes to an approved delivery point, not to any address. A rider accepts your order, collects it from the shop and completes the delivery. You can follow the status on the order page.',
  },
  {
    q: 'How does pickup work?',
    a: 'For pickup you get a one-time code on your order page. Show it at the shop when you collect.',
  },
  {
    q: 'Can I get a refund?',
    a: 'You can ask for a refund or a return from the order page. A person at AFIT Market reviews it, and a refund is only marked done after it has really been processed.',
  },
  {
    q: 'Something went wrong with my order.',
    a: 'Open the order and choose "Report a problem", or send us a message from the contact page.',
  },
  {
    q: 'How do I sell or deliver?',
    a: 'Apply to open a shop or to become a rider. An administrator reviews every application. Riders also need to accept the rider terms once those are published.',
  },
  {
    q: 'Who can see my information?',
    a: 'Shops and riders only see what they need to fulfil your order. See the privacy page for details. You can ask for your data or close your account from Account.',
  },
]

export default function Faq() {
  return (
    <InfoPage title="Help and FAQ" intro="Quick answers to common questions.">
      <ul className="space-y-2">
        {FAQ.map((f) => (
          <li key={f.q}>
            <details className="group rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]">
              <summary className="touch-target flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-navy-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <Icon
                  name="chevron-down"
                  size={18}
                  className="shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-4 pb-4 leading-relaxed">{f.a}</p>
            </details>
          </li>
        ))}
      </ul>
      <p>
        Still stuck?{' '}
        <Link href="/contact" className="font-bold text-brand-700 underline">
          Contact us
        </Link>
        .
      </p>
    </InfoPage>
  )
}
