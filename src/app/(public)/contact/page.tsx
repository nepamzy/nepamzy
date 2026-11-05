import type { Metadata } from 'next'
import { ContactForm } from '@/components/domain/contact-form'
import { InfoPage } from '@/components/shells/info-page'
import { Icon } from '@/components/ui/icons'
import { WhatsAppLink } from '@/components/landing/whatsapp'
import { supportEmail } from '@/lib/contact'

export const metadata: Metadata = { title: 'Contact us' }

export default function Contact() {
  return (
    <InfoPage
      title="Contact us"
      intro="Send us a message and we will reply by email. For a problem with an order, open the order and choose Report a problem."
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <aside className="space-y-3 rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
          <WhatsAppLink className="w-full" />
          {supportEmail() && (
            <p className="flex items-start gap-3">
              <Icon name="mail" className="mt-0.5 text-brand-700" />
              <span>
                <span className="block font-bold text-navy-900">Email</span>
                <a className="text-brand-700 underline" href={`mailto:${supportEmail()}`}>
                  {supportEmail()}
                </a>
              </span>
            </p>
          )}
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
            WhatsApp messages are answered during the day. We do not publish a street address until
            one exists.
          </p>
        </aside>
        <div className="rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
          <ContactForm />
        </div>
      </div>
    </InfoPage>
  )
}
