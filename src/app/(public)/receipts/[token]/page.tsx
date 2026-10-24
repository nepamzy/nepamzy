import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { Money } from '@/components/ui/money'
import { verifyReceipt } from '@/server/modules/delivery-fee/queries'

export const metadata: Metadata = {
  title: 'Check a receipt',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function VerifyReceipt({ params }: { params: Promise<{ token: string }> }) {
  const r = await verifyReceipt((await params).token)
  if ('limited' in r)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <PageHeader title="Check a receipt" />
        <Card role="status">
          <p className="font-semibold">Too many checks from this connection.</p>
          <p className="text-sm text-muted">Please wait a few minutes and try again.</p>
        </Card>
      </div>
    )
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <PageHeader title="Check a receipt" />
      {r.valid ? (
        <Card className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
            Receipt {r.receipt_number}{' '}
            {r.status === 'void' ? (
              <Badge tone="danger">Void</Badge>
            ) : (
              <Badge tone="success">Record found</Badge>
            )}
          </p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <dt className="font-semibold">Delivery fee</dt>
            <dd>
              <Money kobo={r.amount_kobo} /> ({r.currency})
            </dd>
            <dt className="font-semibold">Method</dt>
            <dd>{r.payment_method}</dd>
            <dt className="font-semibold">Issued</dt>
            <dd>{new Date(r.issued_at).toLocaleString('en-NG')}</dd>
            <dt className="font-semibold">Basis</dt>
            <dd>
              {r.basis === 'administrator_resolution'
                ? 'Decided by an administrator after a dispute'
                : 'Customer reported and rider confirmed'}
            </dd>
          </dl>
        </Card>
      ) : (
        <Card>
          <p className="font-semibold">No receipt matches this link.</p>
          <p className="text-sm text-muted">Check that the whole link or QR code was copied.</p>
        </Card>
      )}
      <Card className="mt-4 space-y-2 text-sm">
        <h2 className="text-base font-bold">What this page does and does not show</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>It shows that AFIT Market issued this receipt record. That is all.</li>
          <li>
            It is not a bank statement. AFIT Market cannot see a customer’s or rider’s bank and has
            not checked that any money moved.
          </li>
          <li>
            “Customer reported and rider confirmed” means those two people said so. It is not
            independent verification by a bank or payment provider.
          </li>
          <li>Names and account details are never shown on this page.</li>
        </ul>
      </Card>
    </div>
  )
}
