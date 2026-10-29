import type { Metadata } from 'next'
import { ApplicationForm } from '@/components/domain/application-form'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listCategories } from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Sell on AFIT Market' }

export default async function ApplyPage() {
  const sb = await createSupabaseServerClient()
  const [{ data: apps }, cats, { data: mine }, { data: terms }] = await Promise.all([
    sb
      .from('vendor_applications')
      .select('id, business_name, status, decision_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    listCategories(),
    sb.rpc('my_vendor'),
    sb.rpc('vendor_commission_terms'),
  ])
  const commissionBps = Number((terms as { commission_bps?: number } | null)?.commission_bps ?? 450)
  const pending = (apps ?? []).find((a) => a.status === 'pending')
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Account', href: '/account' }, { label: 'Sell on AFIT Market' }]}
        title="Sell on AFIT Market"
        subtitle="Apply to sell on AFIT Market"
      />
      {mine ? (
        <Card>
          <p>
            You already have a vendor account.{' '}
            <a className="font-semibold text-brand-700 underline" href="/vendor">
              Open your vendor area
            </a>
            .
          </p>
        </Card>
      ) : pending ? (
        <Card className="space-y-1">
          <p className="font-semibold">
            Your application for “{pending.business_name}” is waiting for review.
          </p>
          <p className="text-muted">
            We will review it soon. You will be able to sell once it is approved.
          </p>
        </Card>
      ) : (
        <Card className="max-w-xl">
          <ApplicationForm categories={cats} commissionBps={commissionBps} />
        </Card>
      )}
      {(apps ?? []).filter((a) => a.status !== 'pending').length > 0 && (
        <section className="mt-6" aria-labelledby="past">
          <h2 id="past" className="mb-2 text-lg font-bold">
            Earlier applications
          </h2>
          <ul className="space-y-2">
            {(apps ?? [])
              .filter((a) => a.status !== 'pending')
              .map((a) => (
                <li key={a.id}>
                  <Card className="p-3 sm:p-3">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{a.business_name}</span>
                      <Badge tone={a.status === 'approved' ? 'success' : 'danger'}>
                        {a.status === 'approved' ? 'Approved' : 'Not approved'}
                      </Badge>
                    </p>
                    {a.decision_reason && <p className="text-sm text-muted">{a.decision_reason}</p>}
                  </Card>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  )
}
