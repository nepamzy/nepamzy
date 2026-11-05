'use client'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/icons'
import { cn } from '@/components/ui/cn'

const STEPS: { icon: IconName; title: string; who: string; text: string }[] = [
  {
    icon: 'cart',
    title: 'Order placed and paid',
    who: 'You',
    text: 'You pick items, check the total and pay with Paystack.',
  },
  {
    icon: 'store',
    title: 'The shop prepares it',
    who: 'Shop',
    text: 'The shop accepts your order and tells you when it is ready.',
  },
  {
    icon: 'bike',
    title: 'A rider takes it',
    who: 'Rider',
    text: 'The rider collects it with a one-time code and sets off.',
  },
  {
    icon: 'pin',
    title: 'You follow the map',
    who: 'You',
    text: 'Your rider appears on a live map as they come to you.',
  },
  {
    icon: 'check-circle',
    title: 'Handed over at the door',
    who: 'Rider and you',
    text: 'You sign on the rider’s phone, or scan their QR code. Done.',
  },
]

/** A walk through one order. It plays by itself, can be paused, and every step can be tapped. It is an example, not a real order. */
export function OrderDemo() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3200)
    return () => clearInterval(t)
  }, [playing])
  const s = STEPS[step]!
  return (
    <div className="rounded-[var(--radius-card)] bg-navy-900 p-5 text-white shadow-[var(--shadow-card)] sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-gold-400">
            Follow an order
          </p>
          <h3 className="text-2xl font-extrabold sm:text-3xl">From tap to your door</h3>
        </div>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={!playing}
          className="touch-target rounded-full border border-white/30 px-4 font-bold hover:bg-white/10"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <ol className="mt-6 grid gap-2 sm:grid-cols-5">
        {STEPS.map((st, n) => (
          <li key={st.title}>
            <button
              type="button"
              onClick={() => {
                setStep(n)
                setPlaying(false)
              }}
              aria-current={n === step ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition sm:flex-col sm:gap-1 sm:text-center',
                n === step
                  ? 'bg-gold-400 text-ink'
                  : n < step
                    ? 'bg-white/15'
                    : 'bg-white/5 hover:bg-white/10',
              )}
            >
              <span
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-full',
                  n === step ? 'bg-navy-900 text-gold-400' : 'bg-white/10 text-gold-400',
                )}
              >
                <Icon name={st.icon} size={20} />
              </span>
              <span className="text-sm font-bold leading-tight">
                <span className="sr-only">Step {n + 1}: </span>
                {st.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="mt-5 min-h-16 rounded-xl bg-white/10 p-4">
        <p className="text-sm font-bold text-gold-400">
          Step {step + 1} of {STEPS.length} · {s.who}
        </p>
        <p className="mt-1 text-lg">{s.text}</p>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
        <div
          className="h-full rounded-full bg-gold-400 transition-all duration-700"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-navy-text">
        An example of how an order goes. It is not a real order.
      </p>
    </div>
  )
}
