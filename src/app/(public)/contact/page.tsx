import type { Metadata } from 'next'
import { ContactForm } from '@/components/domain/contact-form'
import { InfoPage } from '@/components/shells/info-page'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'Contact us' }

export default function Contact() {
  return (
    <InfoPage
      title="Contact us"
      intro="Send us a message and we will reply by email. For a problem with an order, open the order and choose Report a problem."
    >
      <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
        <aside className="space-y-3 rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
          <p className="flex items-start gap-3">
            <Icon name="mail" className="mt-0.5 text-brand-700" />
            <span>
              <span className="block font-bold text-navy-900">By message</span>
              <span className="text-sm text-muted">
                Use the form. We reply to the email address you give.
              </span>
            </span>
          </p>
          <p className="flex items-start gap-3">
            <Icon name="help" className="mt-0.5 text-brand-700" />
            <span>
              <span className="block font-bold text-navy-900">Order problems</span>
              <span className="text-sm text-muted">
                Open the order in your account and use Report a problem so staff can see it.
              </span>
            </span>
          </p>
          <p className="text-sm text-muted">
            There is no public phone line yet. We do not publish an address until one exists.
          </p>
        </aside>
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
          <ContactForm />
        </div>
      </div>
    </InfoPage>
  )
}
