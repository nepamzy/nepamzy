import type { Metadata } from 'next'
import { ModeSwitch } from '@/components/shells/mode-switch'
import { Alert } from '@/components/ui/alert'
import { Card, PageHeader } from '@/components/ui/card'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { isPrivilegedRole } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Mode' }

export default async function ModePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sp = await searchParams
  const who = await loadPrincipal()
  const staff = who.roles.some(isPrivilegedRole)
  return (
    <>
      <PageHeader
        title="Administrator and Customer mode"
        subtitle="One account, two views."
        breadcrumbs={[{ label: 'My account', href: '/account' }, { label: 'Mode' }]}
      />
      <div className="max-w-xl space-y-4">
        {sp.error === 'rate' && (
          <Alert tone="danger" title="Too many switches">
            Please wait a few minutes and try again.
          </Alert>
        )}
        {staff ? (
          <Card className="space-y-4">
            <p>
              You are in{' '}
              <strong>{who.mode === 'customer' ? 'Customer mode' : 'Administrator mode'}</strong>.
              Customer mode shows the marketplace exactly as a customer sees it, with your own cart
              and orders. Administrator areas are closed while you are in Customer mode.
            </p>
            <ModeSwitch who={who} />
            <p className="text-sm text-muted">
              Switching only changes what you see. Administrator access is checked on the server
              every time, needs your authenticator code, and each switch is recorded in the audit
              log. Switching does not give you any vendor or rider access.
            </p>
          </Card>
        ) : (
          <Alert tone="info" title="Customer mode only">
            Your account does not have administrator access, so there is nothing to switch.
          </Alert>
        )}
      </div>
    </>
  )
}
