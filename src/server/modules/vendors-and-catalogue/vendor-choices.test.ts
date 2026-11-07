import { describe, expect, it } from 'vitest'
import { parseVendorChoices } from './vendor-choices'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const O = '33333333-3333-4333-8333-333333333333'
const cats = [
  { id: A, slug: 'food' },
  { id: B, slug: 'clothing' },
  { id: O, slug: 'other' },
]
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(o))
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x)
  return fd
}

describe('parseVendorChoices', () => {
  it('takes the first category as the main one and the rest as extras', () => {
    expect(parseVendorChoices(form({ vendorType: 'student', category: [B, A, B] }), cats)).toEqual({
      ok: true,
      main: B,
      extras: [A],
      other: null,
      type: 'student',
      place: null,
    })
  })
  it('needs a type, a known category, and the words for "other"', () => {
    expect(parseVendorChoices(form({ category: A }), cats)).toMatchObject({ ok: false })
    expect(parseVendorChoices(form({ vendorType: 'wizard', category: A }), cats)).toMatchObject({
      ok: false,
    })
    expect(parseVendorChoices(form({ vendorType: 'other' }), cats)).toMatchObject({ ok: false })
    expect(
      parseVendorChoices(form({ vendorType: 'other', category: 'not-a-uuid' }), cats),
    ).toMatchObject({ ok: false })
    expect(
      parseVendorChoices(
        form({ vendorType: 'other', category: '44444444-4444-4444-8444-444444444444' }),
        cats,
      ),
    ).toMatchObject({ ok: false })
    expect(
      parseVendorChoices(form({ vendorType: 'other', category: O, otherCategory: 'ab' }), cats),
    ).toMatchObject({ ok: false })
    expect(
      parseVendorChoices(
        form({ vendorType: 'other', category: [A, O], otherCategory: '  Bead\u0000 jewellery ' }),
        cats,
      ),
    ).toMatchObject({
      ok: true,
      main: A,
      extras: [O],
      other: 'Bead jewellery',
    })
  })
  it('asks where the shop is for a shop AFIT already knows', () => {
    expect(parseVendorChoices(form({ vendorType: 'afit_shop', category: A }), cats)).toMatchObject({
      ok: false,
    })
    expect(
      parseVendorChoices(
        form({ vendorType: 'afit_shop', category: A, shopPlace: 'Beside the main gate' }),
        cats,
      ),
    ).toMatchObject({
      ok: true,
      type: 'afit_shop',
      place: 'Beside the main gate',
    })
  })
  it('does not keep a place or other text that was not asked for', () => {
    expect(
      parseVendorChoices(
        form({ vendorType: 'other', category: A, shopPlace: 'x gate', otherCategory: 'whatever' }),
        cats,
      ),
    ).toMatchObject({
      ok: true,
      place: null,
      other: null,
    })
  })
})
