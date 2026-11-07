import { z } from 'zod'

export type VendorType = 'student' | 'afit_shop' | 'other'
export type VendorChoices =
  | { ok: false; error: string }
  | {
      ok: true
      main: string
      extras: string[]
      other: string | null
      type: VendorType
      place: string | null
    }

const MAX_CATEGORIES = 9
const clean = (s: string, max: number) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Reads and checks what a vendor said about themselves and their shop. Pure: the caller supplies the active categories. */
export function parseVendorChoices(
  fd: FormData,
  categories: { id: string; slug: string }[],
): VendorChoices {
  const type = String(fd.get('vendorType') ?? '')
  if (type !== 'student' && type !== 'afit_shop' && type !== 'other')
    return {
      ok: false,
      error: 'Choose whether you are a student, a shop AFIT already knows, or other.',
    }
  const ids = [...new Set(fd.getAll('category').map(String))]
  if (
    ids.length === 0 ||
    ids.length > MAX_CATEGORIES ||
    !ids.every((i) => z.uuid().safeParse(i).success)
  )
    return { ok: false, error: 'Choose what your shop will sell.' }
  const known = new Map(categories.map((c) => [c.id, c.slug]))
  if (!ids.every((i) => known.has(i)))
    return { ok: false, error: 'Choose what your shop will sell.' }
  let other: string | null = null
  if (ids.some((i) => known.get(i) === 'other')) {
    other = clean(String(fd.get('otherCategory') ?? ''), 60)
    if (other.length < 3) return { ok: false, error: 'Tell us what else your shop will sell.' }
  }
  let place: string | null = null
  if (type === 'afit_shop') {
    place = clean(String(fd.get('shopPlace') ?? ''), 120)
    if (place.length < 3) return { ok: false, error: 'Say where your shop is on campus.' }
  }
  return { ok: true, main: ids[0]!, extras: ids.slice(1), other, type, place }
}
