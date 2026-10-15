import type { Metadata } from 'next'
import { NavMenu } from '@/components/shells/nav-menu'
import { ADMIN_NAV } from '@/components/shells/nav-config'

export const metadata: Metadata = { title: 'All sections' }

export default function AdminMenu() {
  return <NavMenu title="All sections" items={ADMIN_NAV} />
}
