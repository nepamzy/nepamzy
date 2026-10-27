import type { Metadata } from 'next'
import { InfoPage } from '@/components/shells/info-page'

export const metadata: Metadata = { title: 'Refunds and returns' }

export default function Refunds() {
  return (
    <InfoPage
      title="Refunds and returns"
      intro="How a problem with a paid order is handled."
      draftNotice
    >
      <section>
        <h2>How to ask</h2>
        <ol>
          <li>Open the order in your account.</li>
          <li>
            Choose Report a problem, ask for a refund, or ask for a return and say what went wrong.
          </li>
          <li>
            A person at AFIT Market reviews it. They may ask for more detail and can see the order
            history.
          </li>
        </ol>
      </section>
      <section>
        <h2>What to expect</h2>
        <ul>
          <li>
            A refund is shown as done only after it has really been processed, not when it is
            requested or approved.
          </li>
          <li>Approval and the payout step are separate and are done by different people.</li>
          <li>Every decision and the reason are recorded.</li>
        </ul>
      </section>
      <section>
        <h2>Not decided yet</h2>
        <p>
          Time limits and what counts as eligible are waiting for the formal policy to be approved.
          Until then each case is decided individually.
        </p>
      </section>
    </InfoPage>
  )
}
