'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/** Draw-to-sign box. Writes a PNG data URL into a hidden `signature` field; touch, pen and mouse supported. */
export function SignaturePad({ label = 'Recipient signature' }: { label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const signedRef = useRef(false)
  const drawing = useRef(false)
  const [signed, setSigned] = useState(false)

  const ctx = () => canvas.current?.getContext('2d') ?? null
  const reset = useCallback(() => {
    const c = canvas.current
    const g = ctx()
    if (!c || !g) return
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
    g.lineWidth = 3
    g.lineCap = 'round'
    g.strokeStyle = '#111111'
    signedRef.current = false
    setSigned(false)
  }, [])
  useEffect(() => reset(), [reset])
  // Add the image at submit time. (React resets the form after every action, which would wipe a hidden input
  // while the drawn signature is still visible; the canvas itself is not affected by a form reset.)
  useEffect(() => {
    const form = canvas.current?.closest('form')
    if (!form) return
    const onFormData = (e: FormDataEvent) => {
      if (signedRef.current && canvas.current)
        e.formData.set('signature', canvas.current.toDataURL('image/png'))
    }
    form.addEventListener('formdata', onFormData)
    return () => form.removeEventListener('formdata', onFormData)
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    const g = ctx()!
    g.beginPath()
    g.moveTo(p.x, p.y)
    g.lineTo(p.x + 0.01, p.y + 0.01)
    g.stroke()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const p = pos(e)
    const g = ctx()!
    g.lineTo(p.x, p.y)
    g.stroke()
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    signedRef.current = true
    setSigned(true)
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold" id="sig-label">
        {label}
      </p>
      <canvas
        ref={canvas}
        width={600}
        height={220}
        role="img"
        aria-labelledby="sig-label"
        aria-describedby="sig-hint"
        className="w-full touch-none rounded-[var(--radius-control)] border-2 border-dashed border-line-strong bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <p id="sig-hint" className="text-sm text-muted">
        Ask the recipient to sign with a finger or stylus.{' '}
        {signed ? 'Signature captured.' : 'Nothing signed yet.'}
      </p>
      <Button type="button" variant="secondary" onClick={reset}>
        Clear signature
      </Button>
    </div>
  )
}
