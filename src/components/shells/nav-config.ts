import type { IconName } from '@/components/ui/icons'

export type NavItem = { href: string; label: string; icon: IconName; group?: string }

export const CUSTOMER_NAV: NavItem[] = [
  { href: '/products', label: 'Browse', icon: 'store' },
  { href: '/cart', label: 'Cart', icon: 'cart' },
  { href: '/orders', label: 'Orders', icon: 'package' },
  { href: '/cases', label: 'Reports', icon: 'help' },
  { href: '/account', label: 'Account', icon: 'user' },
]
export const VENDOR_NAV: NavItem[] = [
  { href: '/vendor', label: 'Home', icon: 'home', group: 'Sell' },
  { href: '/vendor/orders', label: 'Orders', icon: 'clipboard', group: 'Sell' },
  { href: '/vendor/catalogue', label: 'Catalogue', icon: 'package', group: 'Sell' },
  { href: '/vendor/handover', label: 'Handover', icon: 'check-circle', group: 'Sell' },
  { href: '/vendor/returns', label: 'Returns', icon: 'return', group: 'Sell' },
  { href: '/vendor/earnings', label: 'Earnings', icon: 'coins', group: 'Money' },
  { href: '/vendor/profile', label: 'Shop', icon: 'store', group: 'Shop' },
  { href: '/vendor/reviews', label: 'Reviews', icon: 'star', group: 'Shop' },
  { href: '/vendor/help', label: 'Help', icon: 'help', group: 'Shop' },
]
export const RIDER_NAV: NavItem[] = [
  { href: '/rider', label: 'Home', icon: 'home' },
  { href: '/rider/jobs', label: 'Jobs', icon: 'truck' },
  { href: '/rider/history', label: 'History', icon: 'clock' },
  { href: '/rider/payments', label: 'Payments', icon: 'card' },
  { href: '/rider/profile', label: 'Profile', icon: 'user' },
  { href: '/account', label: 'Account', icon: 'shield' },
]
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: 'home', group: 'Overview' },
  { href: '/admin/orders', label: 'Orders', icon: 'package', group: 'Overview' },
  { href: '/admin/reports', label: 'Reports', icon: 'chart', group: 'Overview' },
  { href: '/admin/users', label: 'Users', icon: 'users', group: 'People' },
  { href: '/admin/applications', label: 'Applications', icon: 'file', group: 'People' },
  { href: '/admin/vendors', label: 'Vendors', icon: 'store', group: 'People' },
  { href: '/admin/riders', label: 'Riders', icon: 'bike', group: 'People' },
  { href: '/admin/rider-issues', label: 'Rider issues', icon: 'alert', group: 'People' },
  { href: '/admin/roles', label: 'Roles', icon: 'key', group: 'People' },
  { href: '/admin/payments', label: 'Payments', icon: 'card', group: 'Money' },
  { href: '/admin/settlements', label: 'Settlements', icon: 'coins', group: 'Money' },
  { href: '/admin/delivery-fee-payments', label: 'Delivery fees', icon: 'truck', group: 'Money' },
  { href: '/admin/refunds', label: 'Refunds', icon: 'refund', group: 'Money' },
  { href: '/admin/cases', label: 'Disputes and reports', icon: 'help', group: 'Support' },
  { href: '/admin/returns', label: 'Returns', icon: 'return', group: 'Support' },
  { href: '/admin/reviews', label: 'Reviews', icon: 'star', group: 'Support' },
  { href: '/admin/messages', label: 'Messages', icon: 'mail', group: 'Support' },
  { href: '/admin/products', label: 'Catalogue', icon: 'package', group: 'Catalogue' },
  { href: '/admin/categories', label: 'Categories', icon: 'tag', group: 'Catalogue' },
  { href: '/admin/delivery-points', label: 'Delivery points', icon: 'pin', group: 'Catalogue' },
  { href: '/admin/jobs', label: 'Jobs', icon: 'clock', group: 'Platform' },
  { href: '/admin/settings', label: 'Settings', icon: 'sliders', group: 'Platform' },
  { href: '/admin/audit', label: 'Audit log', icon: 'clipboard', group: 'Platform' },
  { href: '/admin/data-requests', label: 'Data requests', icon: 'database', group: 'Platform' },
]
