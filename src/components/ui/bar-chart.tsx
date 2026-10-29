/**
 * A small accessible bar chart drawn as SVG. The same numbers are also in a visually hidden table for screen readers.
 * Only real data goes in; an empty or all-zero series shows a plain note instead of an empty plot.
 */
export function BarChart({
  data,
  label,
  format = (n) => String(n),
}: {
  data: { label: string; value: number }[]
  label: string
  format?: (n: number) => string
}) {
  const max = Math.max(0, ...data.map((d) => d.value))
  if (data.length === 0 || max === 0)
    return (
      <p className="rounded-[var(--radius-control)] bg-surface px-3 py-6 text-center text-sm text-muted">
        No activity in this period yet.
      </p>
    )
  const W = 600
  const H = 170
  const gap = 4
  const bw = (W - gap * (data.length - 1)) / data.length
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={label} className="w-full">
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-line)" />
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / max) * (H - 18))
          const x = i * (bw + gap)
          return (
            <g key={d.label + i}>
              <rect x={x} y={H - h} width={bw} height={h} rx="3" fill="var(--color-navy-900)" />
              {d.value > 0 && data.length <= 16 && (
                <text
                  x={x + bw / 2}
                  y={H - h - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-ink)"
                >
                  {format(d.value)}
                </text>
              )}
              {(i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0) && (
                <text
                  x={x + bw / 2}
                  y={H + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-muted)"
                >
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label + i}>
                <td>{d.label}</td>
                <td>{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
