import type { Metadata } from 'next'
import { SignUpForm } from '@/components/auth/forms'
import { Card } from '@/components/ui/card'
import { listCategories } from '@/server/modules/vendors-and-catalogue/public'

export const metadata: Metadata = { title: 'Create account' }
export default async function SignUpPage() {
  const categories = (await listCategories()).map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
  return (
    <Card>
      <h1 className="mb-4 text-2xl font-bold">Create your account</h1>
      <SignUpForm categories={categories} />
    </Card>
  )
}
