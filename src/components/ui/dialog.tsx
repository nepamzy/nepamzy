'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './button'

/** Native <dialog>: focus trap, Escape to close and inert background come from the browser. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-card p-5 text-ink shadow-xl backdrop:bg-black/50">
      <h2 id="dlg-title" className="text-lg font-bold">{title}</h2>
      <div className="mt-3">{children}</div>
      <div className="mt-5 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </dialog>
  )
}
