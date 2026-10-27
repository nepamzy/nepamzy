import { cn } from './cn'

/** Progress steps (for example Delivery, Payment, Confirmation). The current step is also announced in text. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Progress" className="mb-6 flex items-center gap-2 text-sm font-semibold">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li
            key={s}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-1 items-center gap-2"
          >
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs',
                state === 'done' && 'border-navy-900 bg-navy-900 text-white',
                state === 'current' && 'border-gold-400 bg-gold-400 text-ink',
                state === 'todo' && 'border-line-strong text-muted',
              )}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={state === 'todo' ? 'text-muted' : 'text-navy-900'}>
              {s}
              {state === 'current' && <span className="sr-only"> (current step)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="h-0.5 flex-1 bg-line" />}
          </li>
        )
      })}
    </ol>
  )
}
