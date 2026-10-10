'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from './button'
import { Card } from './card'
import { cn } from './cn'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('afit-skeleton h-4 rounded bg-line', className)} />
}
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="w-full" />
      <Skeleton className="w-5/6" />
    </div>
  )
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-prose text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  )
}
export function RetryButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter()
  return (
    <Button variant="secondary" onClick={() => router.refresh()}>
      {label}
    </Button>
  )
}
export function ErrorState({
  title = 'Something went wrong',
  children,
  onRetry,
}: {
  title?: string
  children?: ReactNode
  onRetry?: () => void
}) {
  return (
    <Card role="alert" className="border-danger-700 text-center">
      <h2 className="text-lg font-semibold text-danger-700">{title}</h2>
      <p className="mx-auto mt-1 max-w-prose text-muted">
        {children ?? 'Please try again. If it keeps happening, contact support.'}
      </p>
      <div className="mt-4 flex justify-center">
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <RetryButton />
        )}
      </div>
    </Card>
  )
}
export function OfflineBanner() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  if (online) return null
  return (
    <div
      role="status"
      className="bg-warning-50 px-4 py-2 text-center text-sm font-semibold text-warning-700"
    >
      You are offline. Some things may not load or save until you reconnect.
    </div>
  )
}
