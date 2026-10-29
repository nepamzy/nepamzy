import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/card'
import { Icon, type IconName } from '@/components/ui/icons'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { isPrivilegedRole } from '@/server/modules/identity-and-access/policy'
import { myProfile } from '@/server/modules/customer/queries'

export const metadata: Metadata = { title: 'My account' }

const ROLE_LABEL: Record<string, string> = {
  customer: 'Customer',
  vendor_owner: 'Vendor owner',
  vendor_staff: 'Vendor staff',
  rider: 'Rider',
  support_agent: 'Support',
  finance_admin: 'Finance',
  platform_admin: 'Administrator',
}

export default async function AccountPage() {
  const [who, profile] = await Promise.all([loadPrincipal(), myProfile()])
  const staff = who.roles.some(isPrivilegedRole)
  const tiles: { href: string; icon: IconName; title: string; text: string }[] = [
    { href: '/account/profile', icon: 'user', title: 'Profile', text: 'Your name and email.' },
    { href: '/orders', icon: 'package', title: 'Orders', text: 'Track and manage your orders.' },
    {
      href: '/account/wishlist',
      icon: 'heart',
      title: 'Wishlist',
      text: 'Items you saved for later.',
    },
    {
      href: '/account/addresses',
      icon: 'pin',
      title: 'Saved places',
      text: 'Delivery points you use often.',
    },
    {
      href: '/account/receipts',
      icon: 'receipt',
      title: 'Delivery fee receipts',
      text: 'Receipts for delivery fees.',
    },
    {
      href: '/notifications',
      icon: 'bell',
      title: 'Notifications',
      text: 'Updates and email settings.',
    },
    {
      href: '/account/security',
      icon: 'shield',
      title: 'Security',
      text: 'Two-step sign-in (optional).',
    },
    {
      href: '/cases',
      icon: 'help',
      title: 'Help and reports',
      text: 'Report a problem with an order.',
    },
    {
      href: '/account/data-requests',
      icon: 'database',
      title: 'Your data',
      text: 'Copy of your data or close your account.',
    },
    ...(staff
      ? [
          {
            href: '/account/mode',
            icon: 'switch' as IconName,
            title: 'Administrator / Customer mode',
            text: 'Switch the view you are using.',
          },
        ]
      : []),
  ]
  return (
    <>
      <PageHeader
        title="My account"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Account' }]}
      />
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-line bg-card p-5 shadow-[var(--shadow-card)]">
        <span className="grid size-14 place-items-center rounded-full bg-navy-900 text-xl font-extrabold text-white">
          {(profile.displayName ?? profile.email ?? '?').trim()[0]?.toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-lg font-extrabold text-navy-900">
            {profile.displayName ?? 'Add your name'}
          </p>
          <p className="truncate text-muted">{profile.email}</p>
          <p className="mt-1 flex flex-wrap gap-2">
            {who.roles.map((r) => (
              <Badge key={r} tone="brand">
                {ROLE_LABEL[r] ?? r}
              </Badge>
            ))}
          </p>
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={t.icon} />
              </span>
              <span>
                <span className="block font-extrabold text-navy-900">{t.title}</span>
                <span className="text-sm text-muted">{t.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
