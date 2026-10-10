import type { ReactNode } from 'react'

export function Table({
  caption,
  head,
  children,
}: {
  caption: string
  head: string[]
  children: ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-card"
    >
      <table className="w-full min-w-[32rem] text-left text-base">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-brand-50 text-sm">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}
export const Td = ({ children }: { children: ReactNode }) => (
  <td className="px-4 py-3 align-top">{children}</td>
)
