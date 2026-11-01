import type { Metadata } from 'next'
import { DeliveryPointForm, DeliveryPointGeoForm } from '@/components/domain/admin-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Delivery points' }
export default async function DeliveryPoints() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('approved_delivery_points')
    .select(
      'id, label, instructions, sort_order, is_active, lat, lng, geofence_radius_m, is_synthetic',
    )
    .order('sort_order')
    .order('label')
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Delivery points' }]}
        title="Delivery points"
        subtitle="Customers can have orders delivered only to active points. Use only places AFIT has approved; the seeded ones are fictional placeholders near latitude 0 (open sea). To put a point on the real map, give its latitude and longitude (right-click the place in Google Maps and copy the two numbers) and tick the box Real, approved place. Do not use sensitive locations."
      />
      <div className="space-y-3">
        <Card>
          <h2 className="mb-3 font-bold">Add a delivery point</h2>
          <DeliveryPointForm />
        </Card>
        {(data ?? []).map((p) => (
          <Card key={p.id}>
            <DeliveryPointForm p={p} />
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold text-muted">
                Map location {p.is_synthetic ? '(placeholder)' : '(real place)'}
              </p>
              <DeliveryPointGeoForm p={p} />
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
