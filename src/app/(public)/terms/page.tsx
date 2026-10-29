import type { Metadata } from 'next'
import { InfoPage } from '@/components/shells/info-page'

export const metadata: Metadata = { title: 'Terms summary' }

export default function Terms() {
  return (
    <InfoPage
      title="Terms: how AFIT Market works"
      intro="The basic rules in plain language."
      draftNotice
    >
      <section>
        <h2>Who can use it</h2>
        <ul>
          <li>
            You must be 18 or older to create an account. We ask you to confirm this when you
            register.
          </li>
          <li>Keep your sign-in details private and give accurate information.</li>
          <li>Shops and riders must be approved by an administrator before they can work.</li>
        </ul>
      </section>
      <section>
        <h2>Orders</h2>
        <ul>
          <li>Prices and totals are calculated by the server and shown before you pay.</li>
          <li>An unpaid order expires after a while and the stock is released.</li>
          <li>A shop can only prepare an order after payment is confirmed.</li>
        </ul>
      </section>
      <section>
        <h2>Fair use</h2>
        <p>
          Do not misuse the service, post other people&apos;s personal details, or try to get around
          its protections. Accounts can be suspended for misuse.
        </p>
      </section>
    </InfoPage>
  )
}
