import { describe, expect, it } from 'vitest'
import { lagosDate, lagosDateTime, lagosTime } from './time'

describe('Lagos time', () => {
  it('shows the same moment in Nigerian time (UTC+1), whatever the server zone is', () => {
    expect(lagosDateTime('2026-10-31T08:41:00Z')).toBe('31 Oct 2026, 9:41 am')
    expect(lagosDate('2026-10-31T23:30:00Z')).toBe('1 Nov 2026')
    expect(lagosTime('2026-10-31T13:05:00Z')).toBe('2:05 pm')
  })
})
