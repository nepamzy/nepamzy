import type { Metadata } from 'next'
import { CategoryForm } from '@/components/domain/admin-forms'
import { Card, PageHeader } from '@/components/ui/card'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Categories' }
export default async function Categories() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.rpc('admin_list_categories')
  const rows = (data ?? []) as {
    id: string
    slug: string
    name: string
    sort_order: number
    is_active: boolean
  }[]
  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Shown to applicants and as customer filters. Inactive ones are hidden from the public."
      />
      <div className="space-y-3">
        <Card>
          <h2 className="mb-3 font-bold">Add a category</h2>
          <CategoryForm />
        </Card>
        {rows.map((c) => (
          <Card key={c.id}>
            <CategoryForm c={c} />
          </Card>
        ))}
      </div>
    </>
  )
}
