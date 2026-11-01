import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert } from '@/components/ui/alert'
import { Card, PageHeader } from '@/components/ui/card'
import { LEGAL_DRAFTS } from '@/content/legal-drafts.generated'

export const metadata: Metadata = { title: 'Legal drafts' }

export default function LegalDrafts() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Administration', href: '/admin' }, { label: 'Legal drafts' }]}
        title="Legal drafts"
        subtitle="Drafts of the terms and policies, for your lawyer to review. Nothing here is published."
      />
      <Alert tone="warning" title="Drafts only, not legal advice">
        These were written by the engineering team from how the app behaves. A qualified Nigerian
        lawyer must review and approve them before anything is shown to the public. Items in yellow
        square brackets are open questions or decisions.
      </Alert>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {LEGAL_DRAFTS.map((d, i) => (
          <li key={d.slug}>
            <Card className="h-full">
              <Link
                href={`/admin/legal-drafts/${d.slug}`}
                className="text-lg font-extrabold text-navy-900 hover:underline"
              >
                {i + 1}. {d.title}
              </Link>
            </Card>
          </li>
        ))}
      </ol>
    </>
  )
}
