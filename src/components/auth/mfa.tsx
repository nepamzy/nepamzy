'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  removeFactorAction, startEnrollmentAction, verifyEnrollmentAction, verifySignInAction,
} from '@/server/modules/identity-and-access/actions'

export function EnrollFlow({ kind, next }: { kind: 'primary' | 'backup'; next: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const begin = () => start(async () => {
    setError(null)
    const r = await startEnrollmentAction(kind)
    if (r.ok) setSetup({ factorId: r.factorId, qr: r.qr, secret: r.secret })
    else setError(r.error)
  })
  const confirm = (formData: FormData) => start(async () => {
    setError(null)
    if (!setup) return
    const r = await verifyEnrollmentAction(setup.factorId, String(formData.get('code') ?? ''))
    if (r.ok) { setDone(true); router.push(next); router.refresh() } else setError(r.error ?? 'Could not verify.')
  })

  if (done) return <p role="status" className="font-semibold text-success-700">Authenticator added.</p>
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700">{error}</p>}
      {!setup ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-base">
            <li>Install an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or Aegis).</li>
            <li>Choose <strong>Start setup</strong> and scan the picture with the app.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <Button onClick={begin} disabled={pending} className="w-full sm:w-auto">{pending ? 'Starting…' : 'Start setup'}</Button>
        </>
      ) : (
        <form action={confirm} className="space-y-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code to scan with your authenticator app" width={176} height={176} className="rounded border border-line bg-white p-2" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">Can’t scan?</p>
              <p className="text-muted">Type this key into the app instead:</p>
              <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-base">{setup.secret}</code>
            </div>
          </div>
          <Input label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">{pending ? 'Checking…' : 'Confirm and finish'}</Button>
        </form>
      )}
    </div>
  )
}

export type FactorRow = { id: string; name: string; status: 'verified' | 'unverified'; createdAt: string }

export function ChallengeForm({ factors, next }: { factors: FactorRow[]; next: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const verified = factors.filter((f) => f.status === 'verified')
  const [factorId, setFactorId] = useState(verified[0]?.id ?? '')
  const submit = (formData: FormData) => start(async () => {
    setError(null)
    const r = await verifySignInAction(factorId, String(formData.get('code') ?? ''), next)
    if (r && !r.ok) setError(r.error)
  })
  return (
    <form action={submit} className="space-y-4">
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700">{error}</p>}
      {verified.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">Which authenticator are you using?</legend>
          {verified.map((f) => (
            <label key={f.id} className="touch-target flex items-center gap-3">
              <input type="radio" name="factor" className="size-5 accent-[var(--color-brand-700)]" checked={factorId === f.id} onChange={() => setFactorId(f.id)} />{f.name}
            </label>
          ))}
        </fieldset>
      )}
      <Input label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      <Button type="submit" disabled={pending || !factorId} className="w-full">{pending ? 'Checking…' : 'Verify'}</Button>
    </form>
  )
}

export function FactorList({ factors, canRemoveLast }: { factors: FactorRow[]; canRemoveLast: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const verifiedCount = factors.filter((f) => f.status === 'verified').length
  const remove = (id: string) => start(async () => {
    const r = await removeFactorAction(id)
    setMsg({ ok: r.ok, text: r.ok ? 'Authenticator removed.' : (r.error ?? 'Could not remove.') })
    if (r.ok) router.refresh()
  })
  return (
    <div className="space-y-3">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'font-semibold text-success-700' : 'font-semibold text-danger-700'}>{msg.text}</p>}
      {factors.length === 0 && <p className="text-muted">No authenticator set up yet.</p>}
      <ul className="space-y-2">
        {factors.map((f) => (
          <li key={f.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-3">
              <div>
                <p className="font-semibold">{f.name}</p>
                <p className="text-sm text-muted">Added {new Date(f.createdAt).toLocaleDateString('en-NG')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={f.status === 'verified' ? 'success' : 'warning'}>{f.status === 'verified' ? 'Active' : 'Not finished'}</Badge>
                {f.status === 'verified' && (canRemoveLast || verifiedCount > 1) && (
                  <Button variant="danger" disabled={pending} onClick={() => remove(f.id)} aria-label={`Remove ${f.name}`}>Remove</Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
