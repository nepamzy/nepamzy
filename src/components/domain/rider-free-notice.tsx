import { Alert } from '@/components/ui/alert'

/**
 * The rider-facing statement of the CURRENT arrangement. It states what is true now and does not promise that a future
 * delivery-commission feature will also be free. The two exact lines are asserted by tests/e2e/delivery-fee.spec.ts.
 */
export function RiderFreeNotice({ extra }: { extra?: string }) {
  return (
    <Alert plain tone="success" title="Free for riders">
      <p className="font-semibold">Rider earnings: Free of charge.</p>
      <p className="font-semibold">Delivery commission features: Coming Soon</p>
      <p className="text-sm">
        Under the current arrangement AFIT Market takes no commission from your delivery earnings
        and riders use the platform free of charge. {extra}
      </p>
    </Alert>
  )
}
