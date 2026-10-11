import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { VendorCard } from '@/server/modules/vendors-and-catalogue/types'

export function VendorCardView({ v }: { v: VendorCard }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold"><Link className="hover:underline" href={`/vendors/${v.slug}`}>{v.name}</Link></h2>
        <Badge tone={v.open_now ? 'success' : 'neutral'}>{v.open_now ? 'Open now' : 'Closed now'}</Badge>
      </div>
      <p className="mt-1 text-muted">{[v.category_name, `Ready in about ${v.prep_minutes} min`].filter(Boolean).join(' · ')}</p>
      {v.description && <p className="mt-2 line-clamp-2 text-sm">{v.description}</p>}
    </Card>
  )
}
