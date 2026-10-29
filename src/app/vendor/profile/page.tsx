import type { Metadata } from 'next'
import { HoursForm, ProfileForm, StaffSection } from '@/components/domain/shop-forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/states'
import { setClosedAction } from '@/server/modules/vendors-and-catalogue/actions'
import { getMyVendor, getShop } from '@/server/modules/vendors-and-catalogue/vendor-queries'

export const metadata: Metadata = { title: 'Shop settings' }

export default async function ShopPage() {
  const me = await getMyVendor()
  if (!me) return <EmptyState title="No vendor account yet" />
  const { vendor, hours, staff } = await getShop(me.id)
  if (!vendor) return <EmptyState title="We could not load your shop" />
  const owner = me.staff_role === 'owner'
  const disabled = me.status !== 'approved'
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Shop', href: '/vendor' }, { label: 'Settings' }]}
        title="Shop settings"
        subtitle={vendor.name}
      />
      <div className="space-y-5">
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Orders:{' '}
            <Badge tone={vendor.temporarily_closed ? 'warning' : 'success'}>
              {vendor.temporarily_closed ? 'Paused' : 'Open during opening hours'}
            </Badge>
          </p>
          <form action={setClosedAction}>
            <input type="hidden" name="vendorId" value={vendor.id} />
            <input type="hidden" name="closed" value={vendor.temporarily_closed ? '0' : '1'} />
            <Button type="submit" variant="secondary" disabled={disabled}>
              {vendor.temporarily_closed ? 'Resume orders' : 'Pause orders'}
            </Button>
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Profile</h2>
          {owner ? (
            <ProfileForm vendor={vendor} disabled={disabled} />
          ) : (
            <p className="text-muted">Only the owner can edit the shop profile.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Opening hours</h2>
          {owner ? (
            <HoursForm vendorId={vendor.id} hours={hours} disabled={disabled} />
          ) : (
            <p className="text-muted">Only the owner can edit opening hours.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Staff</h2>
          <StaffSection vendorId={vendor.id} staff={staff} isOwner={owner} disabled={disabled} />
        </Card>
      </div>
    </>
  )
}
