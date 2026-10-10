import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'

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
  const who = await loadPrincipal()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return (
    <>
      <PageHeader title="My account" />
      <Card className="space-y-3">
        <p>
          <span className="font-semibold">Email:</span> {data.user?.email}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Your roles:</span>
          {who.roles.map((r) => (
            <Badge key={r} tone="brand">
              {ROLE_LABEL[r] ?? r}
            </Badge>
          ))}
        </p>
        <p>
          <Link className="font-semibold text-brand-700 underline" href="/account/security">
            Security and authenticators
          </Link>
        </p>
      </Card>
    </>
  )
}
