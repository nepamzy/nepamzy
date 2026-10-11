/** Product option groups: JSON typed into the editor -> validated payload for product_upsert. Pure, unit-tested. */
import { nairaToKobo } from '@/server/modules/shared/money-input'

export type OptionGroupInput = { name: string; min: number; max: number; options: { name: string; price_delta_kobo: number; available: boolean }[] }

type Raw = { name?: unknown; min?: unknown; max?: unknown; options?: { name?: unknown; price?: unknown; available?: unknown }[] }

export function parseOptionGroups(json: string): { groups: OptionGroupInput[] } | { error: string } {
  if (!json.trim()) return { groups: [] }
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return { error: 'The options could not be read. Reload the page and try again.' } }
  if (!Array.isArray(raw) || raw.length > 10) return { error: 'A product can have at most 10 option groups.' }
  const groups: OptionGroupInput[] = []
  for (const g of raw as Raw[]) {
    const name = typeof g.name === 'string' ? g.name.trim() : ''
    if (name.length < 1 || name.length > 40) return { error: 'Every option group needs a name (up to 40 characters).' }
    const opts = Array.isArray(g.options) ? g.options : []
    if (opts.length < 1 || opts.length > 20) return { error: `"${name}" needs between 1 and 20 choices.` }
    const min = Number(g.min ?? 0); const max = Number(g.max ?? 1)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max || max > opts.length) {
      return { error: `"${name}": check "at least" and "at most" - at most cannot exceed the number of choices.` }
    }
    const options: OptionGroupInput['options'] = []
    for (const o of opts) {
      const on = typeof o.name === 'string' ? o.name.trim() : ''
      if (on.length < 1 || on.length > 40) return { error: `Every choice in "${name}" needs a name (up to 40 characters).` }
      const priceText = typeof o.price === 'string' || typeof o.price === 'number' ? String(o.price) : '0'
      const kobo = priceText.trim() === '' ? 0 : nairaToKobo(priceText)
      if (kobo === null) return { error: `"${on}": enter the extra price in naira, for example 200 or 0.` }
      options.push({ name: on, price_delta_kobo: kobo, available: o.available !== false })
    }
    groups.push({ name, min, max, options })
  }
  return { groups }
}
