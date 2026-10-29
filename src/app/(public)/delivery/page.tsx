import type { Metadata } from 'next'
import { InfoPage } from '@/components/shells/info-page'

export const metadata: Metadata = { title: 'Delivery' }

export default function Delivery() {
  return (
    <InfoPage title="Delivery" intro="How pickup and delivery work.">
      <section>
        <h2>Pickup</h2>
        <p>
          When your order is ready you get a one-time pickup code on the order page. Show it at the
          shop. The shop checks the code before handing over your order.
        </p>
      </section>
      <section>
        <h2>Delivery</h2>
        <ul>
          <li>Delivery goes to an approved delivery point, chosen at checkout.</li>
          <li>
            An approved rider accepts the order, collects it from the shop and completes the
            delivery.
          </li>
          <li>
            You can follow the status on your order page. Delivery completion is confirmed with a
            proof step.
          </li>
        </ul>
      </section>
      <section>
        <h2>Delivery fee</h2>
        <p>
          The delivery fee is shown at checkout. By default it is paid with the rest of your order
          through Paystack. If direct payment to the rider is ever switched on, your order page says
          so clearly and you will never be asked to pay the delivery fee twice.
        </p>
      </section>
    </InfoPage>
  )
}
