import type { ReactNode } from 'react'

/** Square-bracket items are open questions for counsel or decisions for the owner: highlight them so they are easy to spot. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]{3,}\])/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${key}${i}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`'))
      out.push(
        <code key={`${key}${i}`} className="rounded bg-surface px-1 text-sm">
          {t.slice(1, -1)}
        </code>,
      )
    else
      out.push(
        <mark key={`${key}${i}`} className="rounded bg-gold-400/30 px-1 text-ink">
          {t}
        </mark>,
      )
    last = m.index + t.length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

/** A small, safe Markdown renderer for the legal drafts: headings, paragraphs, lists, tables, quotes. No raw HTML. */
export function MarkdownLite({ source }: { source: string }) {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let n = 0
  while (i < lines.length) {
    const line = lines[i]!
    const key = `b${n++}`
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const cls =
        level === 1
          ? 'text-2xl font-extrabold text-navy-900'
          : level === 2
            ? 'mt-4 text-xl font-extrabold text-navy-900'
            : 'mt-2 text-lg font-bold text-navy-900'
      blocks.push(
        level === 1 ? (
          <h2 key={key} className={cls}>
            {inline(h[2]!, key)}
          </h2>
        ) : (
          <h3 key={key} className={cls}>
            {inline(h[2]!, key)}
          </h3>
        ),
      )
      i++
    } else if (line.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) q.push(lines[i++]!.replace(/^>\s?/, ''))
      blocks.push(
        <blockquote
          key={key}
          className="rounded-lg border-l-4 border-gold-400 bg-gold-400/15 p-3 text-sm"
        >
          {inline(q.join(' '), key)}
        </blockquote>,
      )
    } else if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const l = lines[i++]!
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) rows.push(cells(l))
      }
      const [head, ...body] = rows
      blocks.push(
        <div key={key} className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {head?.map((c, j) => (
                  <th key={j} className="border border-line bg-surface p-2 font-bold">
                    {inline(c, `${key}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-line p-2 align-top">
                      {inline(c, `${key}${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else if (/^\s*(-|\*)\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (
        i < lines.length &&
        (/^\s*(-|\*)\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!))
      )
        items.push(lines[i++]!.replace(/^\s*(-|\*|\d+\.)\s+/, ''))
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(
        <Tag key={key} className={ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}>
          {items.map((t, j) => (
            <li key={j} className="mt-1">
              {inline(t, `${key}${j}`)}
            </li>
          ))}
        </Tag>,
      )
    } else {
      const p: string[] = []
      while (
        i < lines.length &&
        lines[i]!.trim() &&
        !/^(#|>|\||\s*(-|\*)\s|\s*\d+\.\s)/.test(lines[i]!)
      )
        p.push(lines[i++]!)
      blocks.push(
        <p key={key} className="leading-relaxed">
          {inline(p.join(' '), key)}
        </p>,
      )
    }
  }
  return <div className="space-y-3">{blocks}</div>
}
