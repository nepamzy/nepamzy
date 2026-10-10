import type { Metadata } from 'next'
import { EmptyState } from '@/components/ui/states'
import { PageHeader } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Jobs' }
export default function Jobs() {
  return (
    <>
      <PageHeader title="Jobs" />
      <EmptyState title="No jobs yet">
        Delivery offers will appear here once delivery opens and you are active.
      </EmptyState>
    </>
  )
}
