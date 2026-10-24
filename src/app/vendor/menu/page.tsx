import type { Metadata } from 'next'
import { NavMenu } from '@/components/shells/nav-menu'
import { VENDOR_NAV } from '@/components/shells/nav-config'

export const metadata: Metadata = { title: 'All sections' }

export default function VendorMenu() {
  return <NavMenu title="All sections" items={VENDOR_NAV} />
}
