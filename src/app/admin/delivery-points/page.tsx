import type { Metadata } from 'next'
import { DeliveryPointForm } from '@/components/domain/admin-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Delivery points' }
export default async function DeliveryPoints() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('approved_delivery_points')
    .select('id, label, instructions, sort_order, is_active')
    .order('sort_order')
    .order('label')
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Delivery points' }]}
        title="Delivery points"
        subtitle="Customers can have orders delivered only to active points. Use only places AFIT has approved; the seeded ones are fictional placeholders. Do not enter coordinates or sensitive locations."
      />
      <div className="space-y-3">
        <Card>
          <h2 className="mb-3 font-bold">Add a delivery point</h2>
          <DeliveryPointForm />
        </Card>
        {(data ?? []).map((p) => (
          <Card key={p.id}>
            <DeliveryPointForm p={p} />
          </Card>
        ))}
      </div>
    </>
  )
}
