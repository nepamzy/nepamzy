'use client'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from './cn'

type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' }
const Ctx = createContext<(message: string, tone?: Toast['tone']) => void>(() => undefined)
export const useToast = () => useContext(Ctx)

/** Toasts never carry critical information alone: important results are also shown in the page. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, message, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 6000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto rounded-[var(--radius-control)] px-4 py-3 text-sm font-semibold shadow-lg',
            t.tone === 'success' && 'bg-success-700 text-white', t.tone === 'error' && 'bg-danger-700 text-white', t.tone === 'info' && 'bg-ink text-white')}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
