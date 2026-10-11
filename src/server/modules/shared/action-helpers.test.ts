import { describe, expect, it } from 'vitest'
import { int, nairaToKobo, text } from './action-helpers'


const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

describe('nairaToKobo', () => {
  it.each([['1500', 150000], ['₦1,500', 150000], ['1,500.5', 150050], ['0.05', 5], ['99999999.99', 9999999999], [' 10 ', 1000]])('%s -> %s', (i, o) => expect(nairaToKobo(i)).toBe(o))
  it.each([[''], ['abc'], ['-5'], ['1.234'], ['1e5'], ['100000000'], ['12.'], ['.5']])('rejects %j', (i) => expect(nairaToKobo(i)).toBeNull())
})
describe('form readers', () => {
  it('trim, cap length and parse bounded integers', () => {
    expect(text(fd({ a: '  hi  ' }), 'a')).toBe('hi'); expect(text(fd({ a: 'x'.repeat(50) }), 'a', 10)).toHaveLength(10); expect(text(fd({}), 'a')).toBe('')
    expect(int(fd({ n: '42' }), 'n')).toBe(42); expect(int(fd({ n: '4.2' }), 'n')).toBeNull(); expect(int(fd({ n: '1234567890' }), 'n')).toBeNull(); expect(int(fd({}), 'n')).toBeNull()
  })
})
