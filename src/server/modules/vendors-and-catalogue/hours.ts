/** Opening-hours form <-> JSON for vendor_set_hours. Pure and unit-tested. Up to two ranges per day. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const T = /^([01]\d|2[0-3]):[0-5]\d$/

type Interval = { weekday: number; opens: string; closes: string }

export function buildHoursJson(fd: FormData): { hours: Interval[] } | { error: string } {
  const hours: Interval[] = []
  for (let d = 0; d < 7; d++) {
    if (fd.get(`d${d}_open`) !== 'on') continue
    const ranges: [string, string][] = [
      [String(fd.get(`d${d}_from`) ?? ''), String(fd.get(`d${d}_to`) ?? '')],
      [String(fd.get(`d${d}_from2`) ?? ''), String(fd.get(`d${d}_to2`) ?? '')],
    ]
    let any = false
    for (const [i, [from, to]] of ranges.entries()) {
      if (i === 1 && !from && !to) continue
      if (!T.test(from) || !T.test(to)) return { error: `${WEEKDAYS[d]}: enter opening and closing times like 08:00 and 18:00.` }
      if (from >= to) return { error: `${WEEKDAYS[d]}: closing time must be after opening time.` }
      hours.push({ weekday: d, opens: from, closes: to }); any = true
    }
    if (!any) return { error: `${WEEKDAYS[d]}: add opening times or untick the day.` }
  }
  return { hours }
}

/** Groups stored intervals by weekday for the form defaults. */
export function hoursByDay(rows: { weekday: number; opens: string; closes: string }[]) {
  const out: Record<number, { from: string; to: string }[]> = {}
  for (const r of rows) (out[r.weekday] ??= []).push({ from: r.opens.slice(0, 5), to: r.closes.slice(0, 5) })
  for (const k of Object.keys(out)) out[Number(k)]!.sort((a, b) => a.from.localeCompare(b.from))
  return out
}
