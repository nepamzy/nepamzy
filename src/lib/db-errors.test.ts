import { describe, expect, it } from 'vitest'
import { describeProblems, friendlyDbError, parseProblems } from './db-errors'

describe('friendlyDbError', () => {
  it('maps known codes and never leaks raw SQL/constraint text', () => {
    expect(friendlyDbError({ message: 'MFA (aal2) required' })).toMatch(/authenticator/)
    expect(friendlyDbError({ message: 'forbidden' })).toMatch(/not allowed/)
    expect(friendlyDbError({ message: 'out_of_stock:abc' })).toBe('Something went wrong. Please try again.')
    expect(friendlyDbError({ message: 'new row for relation "products" violates check constraint "x"', code: '23514' })).not.toMatch(/relation|constraint/)
    expect(friendlyDbError({ message: 'duplicate key value violates unique constraint "vendors_slug_key"', code: '23505' })).not.toMatch(/vendors_slug_key/)
    expect(friendlyDbError(null, 'fallback')).toBe('fallback')
  })
  it('turns checkout problems into customer language', () => {
    const details = JSON.stringify([{ code: 'out_of_stock', product_id: 'p' }, { code: 'vendor_closed' }])
    expect(friendlyDbError({ message: 'checkout_blocked', details })).toMatch(/run out of stock/)
    expect(describeProblems(parseProblems(details))).toEqual(['An item in your cart has run out of stock.', 'This vendor is closed right now.'])
  })
  it('survives malformed details', () => {
    expect(parseProblems('not json')).toEqual([]); expect(parseProblems(null)).toEqual([]); expect(parseProblems('{"a":1}')).toEqual([])
    expect(describeProblems([{ code: 'something_new' }])).toEqual(['Something in your order needs attention.'])
  })
})
