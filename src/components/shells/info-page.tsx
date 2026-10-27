import type { ReactNode } from 'react'
import { Alert } from '@/components/ui/alert'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'

/** Frame for About, FAQ, delivery, payment, refund and similar pages. `draftNotice` marks plain-language summaries that are NOT approved legal terms. */
export function InfoPage({
  title,
  intro,
  draftNotice = false,
  children,
}: {
  title: string
  intro?: string
  draftNotice?: boolean
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: title }]} />
      <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">{title}</h1>
      {intro && <p className="mt-2 text-lg text-muted">{intro}</p>}
      {draftNotice && (
        <Alert tone="warning" title="Plain-language summary, not legal terms" className="mt-4">
          This page explains how AFIT Market works today. The formal terms and policies are still
          waiting for legal review and approval, so nothing here is a final or binding legal
          document.
        </Alert>
      )}
      <div className="mt-6 space-y-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-navy-900 [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </div>
  )
}
