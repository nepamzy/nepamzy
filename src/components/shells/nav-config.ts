import type { NavItem } from './nav-links'

export const CUSTOMER_NAV: NavItem[] = [
  { href: '/vendors', label: 'Browse', icon: '🛍' },
  { href: '/cart', label: 'Cart', icon: '🛒' },
  { href: '/orders', label: 'Orders', icon: '📦' },
  { href: '/account', label: 'Account', icon: '👤' },
]
export const VENDOR_NAV: NavItem[] = [
  { href: '/vendor', label: 'Home', icon: '🏠' },
  { href: '/vendor/orders', label: 'Orders', icon: '📋' },
  { href: '/vendor/catalogue', label: 'Catalogue', icon: '🍽' },
  { href: '/vendor/profile', label: 'Shop', icon: '🏪' },
  { href: '/vendor/handover', label: 'Handover', icon: '🤝' },
]
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Home', icon: '🏠' },
  { href: '/admin/applications', label: 'Applications', icon: '📝' },
  { href: '/admin/vendors', label: 'Vendors', icon: '🏪' },
  { href: '/admin/riders', label: 'Riders', icon: '🏍' },
  { href: '/admin/rider-issues', label: 'Rider issues', icon: '⚠️' },
  { href: '/admin/payments', label: 'Payments', icon: '💳' },
  { href: '/admin/audit', label: 'Audit', icon: '🧾' },
  { href: '/admin/roles', label: 'Roles', icon: '🔑' },
]
