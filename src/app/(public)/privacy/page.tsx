import type { Metadata } from 'next'
import Link from 'next/link'
import { InfoPage } from '@/components/shells/info-page'

export const metadata: Metadata = { title: 'Privacy summary' }

export default function Privacy() {
  return (
    <InfoPage
      title="Privacy summary"
      intro="What we keep and who can see it, in plain language."
      draftNotice
    >
      <section>
        <h2>What we keep</h2>
        <ul>
          <li>Your account email and sign-in security details.</li>
          <li>Your orders, payments records and the delivery point you choose.</li>
          <li>Messages and reports you send to us.</li>
          <li>
            For riders: bank details are encrypted, and rider location is used only while a delivery
            is active.
          </li>
        </ul>
      </section>
      <section>
        <h2>Who sees it</h2>
        <ul>
          <li>Shops see what they need to prepare your order.</li>
          <li>Riders see what they need to deliver it.</li>
          <li>
            Administrators and support see order and payment records to help you, and their actions
            are logged.
          </li>
        </ul>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You can ask for a copy of your data or close your account from{' '}
          <Link href="/account/data-requests" className="font-bold text-brand-700 underline">
            Account, Your data and account closure
          </Link>
          . Some financial records must be kept for a period, so closing an account removes personal
          details but not those records.
        </p>
      </section>
    </InfoPage>
  )
}
