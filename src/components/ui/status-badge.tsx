import { Badge, type Tone } from './badge'

const RULES: [RegExp, Tone][] = [
  [
    /(fail|cancel|reject|refus|suspend|disput|dead|expire|declin|denied|error|unreceived|mismatch)/i,
    'danger',
  ],
  [
    /(paid|complete|deliver|active|approv|confirm|verif|sent|resolv|success|received|settled|published|open_for)/i,
    'success',
  ],
  [/(transit|assign|picked|out_for|shipped|ready|accepted|on_the_way)/i, 'info'],
  [/(pend|await|prepar|process|submit|review|queue|draft|wait|hold|claim)/i, 'warning'],
]

/** One status vocabulary for every list and table. The words carry the meaning; colour and the dot only support them. */
export function toneFor(status: string): Tone {
  for (const [re, tone] of RULES) if (re.test(status)) return tone
  return 'neutral'
}

export const prettyStatus = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={toneFor(status)} data-status={status}>
      <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />
      {label ?? prettyStatus(status)}
    </Badge>
  )
}
