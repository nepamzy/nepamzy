import type { Metadata } from 'next'
import { InfoPage } from '@/components/shells/info-page'

export const metadata: Metadata = { title: 'Payments' }

export default function Payments() {
  return (
    <InfoPage title="Payments" intro="How you pay and what you see." draftNotice>
      <section>
        <h2>How you pay</h2>
        <p>
          Payment is online through Paystack (cards and bank transfer, as Paystack offers them). The
          total is calculated by the server from current prices and is shown before you pay.
        </p>
      </section>
      <section>
        <h2>Test mode</h2>
        <p>
          While AFIT Market is a pre-launch preview, payments run in test mode. No real money moves
          and test payments are not real purchases.
        </p>
      </section>
      <section>
        <h2>Receipts and fees</h2>
        <ul>
          <li>
            Your order page shows what you paid, and receipts are available for delivery fee
            payments.
          </li>
          <li>
            Customers pay no platform fee. Shops pay a 4.5% commission on the product subtotal after
            discounts, not on delivery.
          </li>
          <li>We never show or store your card details; Paystack handles them.</li>
        </ul>
      </section>
    </InfoPage>
  )
}
