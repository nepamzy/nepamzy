import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'
const tones: Record<Tone, string> = {
  neutral: 'bg-[#e9ecea] text-ink',
  info: 'bg-info-50 text-info-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  brand: 'bg-brand-50 text-brand-800',
}
export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold', tones[tone], className)} {...props} />
}
