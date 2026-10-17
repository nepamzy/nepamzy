import { formatNaira } from '@/lib/money'

export function Money({ kobo, className }: { kobo: number; className?: string }) {
  return <span className={className}>{formatNaira(kobo)}</span>
}
