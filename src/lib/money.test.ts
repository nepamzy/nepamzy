import { describe, expect, it } from 'vitest'
import { formatNaira } from './money'

describe('formatNaira (integer kobo)', () => {
  it.each([
    [0, '₦0'], [100, '₦1'], [250000, '₦2,500'], [5050, '₦50.50'], [5, '₦0.05'],
    [123456789, '₦1,234,567.89'], [-150, '-₦1.50'],
  ])('%s -> %s', (k, out) => expect(formatNaira(k)).toBe(out))
  it('supports bigint', () => expect(formatNaira(9007199254740993n)).toBe('₦90,071,992,547,409.93'))
  it('rejects fractional kobo', () => expect(() => formatNaira(10.5)).toThrow(RangeError))
})
