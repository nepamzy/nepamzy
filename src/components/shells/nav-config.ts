import type { NavItem } from './nav-links'

export const CUSTOMER_NAV: NavItem[] = [
  { href: '/vendors', label: 'Browse', icon: '🛍' },
  { href: '/cart', label: 'Cart', icon: '🛒' },
  { href: '/orders', label: 'Orders', icon: '📦' },
  { href: '/cases', label: 'Reports', icon: '📣' },
  { href: '/account', label: 'Account', icon: '👤' },
]
export const VENDOR_NAV: NavItem[] = [
  { href: '/vendor', label: 'Home', icon: '🏠' },
  { href: '/vendor/orders', label: 'Orders', icon: '📋' },
  { href: '/vendor/catalogue', label: 'Catalogue', icon: '🍽' },
  { href: '/vendor/profile', label: 'Shop', icon: '🏪' },
  { href: '/vendor/handover', label: 'Handover', icon: '🤝' },
  { href: '/vendor/returns', label: 'Returns', icon: '↩️' },
  { href: '/vendor/earnings', label: 'Earnings', icon: '💰' },
]
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Home', icon: '🏠' },
  { href: '/admin/applications', label: 'Applications', icon: '📝' },
  { href: '/admin/vendors', label: 'Vendors', icon: '🏪' },
  { href: '/admin/riders', label: 'Riders', icon: '🏍' },
  { href: '/admin/rider-issues', label: 'Rider issues', icon: '⚠️' },
  { href: '/admin/payments', label: 'Payments', icon: '💳' },
  { href: '/admin/refunds', label: 'Refunds', icon: '💸' },
  { href: '/admin/cases', label: 'Reports', icon: '📣' },
  { href: '/admin/returns', label: 'Returns', icon: '↩️' },
  { href: '/admin/settlements', label: 'Settlements', icon: '💰' },
  { href: '/admin/reviews', label: 'Reviews', icon: '⭐' },
  { href: '/admin/jobs', label: 'Jobs', icon: '⚙️' },
  { href: '/admin/settings', label: 'Settings', icon: '🎛' },
  { href: '/admin/audit', label: 'Audit', icon: '🧾' },
  { href: '/admin/roles', label: 'Roles', icon: '🔑' },
  { href: '/admin/data-requests', label: 'Data requests', icon: '🗃' },
  { href: '/admin/delivery-points', label: 'Delivery points', icon: '📍' },
  { href: '/admin/categories', label: 'Categories', icon: '🗂' },
]
