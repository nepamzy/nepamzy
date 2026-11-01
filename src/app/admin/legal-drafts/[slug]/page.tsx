import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarkdownLite } from '@/components/domain/markdown-lite'
import { Card, PageHeader } from '@/components/ui/card'
import { LEGAL_DRAFTS } from '@/content/legal-drafts.generated'

export const metadata: Metadata = { title: 'Legal draft' }

export default async function LegalDraft({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = LEGAL_DRAFTS.find((d) => d.slug === slug)
  if (!doc) notFound()
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Administration', href: '/admin' },
          { label: 'Legal drafts', href: '/admin/legal-drafts' },
          { label: doc.title },
        ]}
        title={doc.title}
        subtitle="DRAFT, not approved for publication."
      />
      <Card className="max-w-4xl">
        <MarkdownLite source={doc.markdown} />
      </Card>
    </>
  )
}
