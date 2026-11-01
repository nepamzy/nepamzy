import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignatureSetupForm } from '@/components/auth/signature-setup-form'
import { PageHeader } from '@/components/ui/card'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'
import { hasSignature } from '@/server/modules/identity-and-access/identity'
import { safeNextPath } from '@/server/modules/identity-and-access/policy'

export const metadata: Metadata = { title: 'Your signature' }

export default async function SignatureSetup({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const next = safeNextPath((await searchParams).next)
  const who = await loadPrincipal()
  if (who.userId && (await hasSignature(who.userId))) redirect(next)
  return (
    <>
      <PageHeader
        title="Save your signature"
        subtitle="One quick step, once. You need it to receive deliveries and sign for orders."
      />
      <div className="max-w-xl">
        <SignatureSetupForm next={next} />
      </div>
    </>
  )
}
