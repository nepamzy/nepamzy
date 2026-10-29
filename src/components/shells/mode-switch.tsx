import Link from 'next/link'
import { headers } from 'next/headers'
import { switchModeAction } from '@/server/modules/identity-and-access/actions'
import { Icon } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'
import { safeNextPath, type Principal } from '@/server/modules/identity-and-access/policy'

/** Shown only to accounts that hold a staff role. Which mode is active is also announced in text, not only by colour. */
export async function ModeSwitch({
  who,
  dark = false,
}: {
  who: Principal
  /** On the navy sidebar. */
  dark?: boolean
}) {
  const next = safeNextPath((await headers()).get('x-pathname'))
  const admin = who.mode !== 'customer'
  const btn = (to: 'customer' | 'admin', label: string, on: boolean) => (
    <button
      type="submit"
      name="to"
      value={to}
      aria-pressed={on}
      disabled={on}
      className={cn(
        'touch-target flex-1 rounded-lg px-3 py-1.5 text-sm font-bold',
        on
          ? 'bg-gold-400 text-ink'
          : dark
            ? 'text-navy-text hover:bg-navy-700 hover:text-white'
            : 'text-brand-800 hover:bg-brand-50',
      )}
    >
      {label}
    </button>
  )
  return (
    <form action={switchModeAction} aria-label="Switch mode">
      <input type="hidden" name="next" value={next} />
      <p
        className={cn(
          'mb-1.5 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider',
          dark ? 'text-navy-text/80' : 'text-muted',
        )}
      >
        <Icon name="switch" size={14} /> Mode: {admin ? 'Administrator' : 'Customer'}
      </p>
      <div
        className={cn(
          'flex gap-1 rounded-xl p-1',
          dark ? 'bg-navy-950' : 'border border-line bg-surface',
        )}
      >
        {btn('customer', 'Customer', !admin)}
        {btn('admin', 'Administrator', admin)}
      </div>
    </form>
  )
}

export function ModePill({ who }: { who: Principal }) {
  if (
    !who.roles.some((r) => r === 'platform_admin' || r === 'finance_admin' || r === 'support_agent')
  )
    return null
  const admin = who.mode !== 'customer'
  return (
    <span
      data-mode-indicator
      className={cn(
        'hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold sm:inline-flex',
        admin ? 'bg-gold-400 text-ink' : 'bg-brand-50 text-brand-800',
      )}
    >
      <Icon name={admin ? 'shield' : 'user'} size={14} />
      {admin ? 'Administrator mode' : 'Customer mode'}
    </span>
  )
}

/** Phone-width strip under the header so the active mode is always visible where the pill does not fit. */
export function ModeBar({ who }: { who: Principal }) {
  if (
    !who.roles.some((r) => r === 'platform_admin' || r === 'finance_admin' || r === 'support_agent')
  )
    return null
  const admin = who.mode !== 'customer'
  return (
    <div
      data-mode-indicator
      className={cn(
        'flex items-center justify-between gap-2 px-4 py-1.5 text-sm font-bold sm:hidden',
        admin ? 'bg-gold-400 text-ink' : 'bg-brand-50 text-brand-800',
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon name={admin ? 'shield' : 'user'} size={16} />
        {admin ? 'Administrator mode' : 'Customer mode'}
      </span>
      <Link href="/account/mode" className="underline">
        Switch
      </Link>
    </div>
  )
}
