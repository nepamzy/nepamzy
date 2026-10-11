import { describe, expect, it } from 'vitest'
import { buildHoursJson, hoursByDay } from './hours'
import { parseOptionGroups } from './options'

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }

describe('buildHoursJson', () => {
  it('builds intervals for ticked days, with an optional second range', () => {
    const r = buildHoursJson(fd({ d1_open: 'on', d1_from: '08:00', d1_to: '12:00', d1_from2: '13:00', d1_to2: '18:00', d2_open: 'on', d2_from: '09:00', d2_to: '17:00' }))
    expect(r).toEqual({ hours: [{ weekday: 1, opens: '08:00', closes: '12:00' }, { weekday: 1, opens: '13:00', closes: '18:00' }, { weekday: 2, opens: '09:00', closes: '17:00' }] })
  })
  it('an empty form means closed every day', () => expect(buildHoursJson(fd({}))).toEqual({ hours: [] }))
  it.each([
    [{ d1_open: 'on', d1_from: '18:00', d1_to: '08:00' }, /after opening/], [{ d1_open: 'on', d1_from: '8am', d1_to: '9pm' }, /like 08:00/],
    [{ d1_open: 'on' }, /like 08:00/], [{ d1_open: 'on', d1_from: '08:00', d1_to: '12:00', d1_from2: '13:00' }, /like 08:00/],
    [{ d1_open: 'on', d1_from: '25:00', d1_to: '26:00' }, /like 08:00/],
  ])('rejects %j', (o, msg) => expect(JSON.stringify(buildHoursJson(fd(o)))).toMatch(msg))
  it('hoursByDay groups and sorts', () => {
    expect(hoursByDay([{ weekday: 1, opens: '13:00:00', closes: '18:00:00' }, { weekday: 1, opens: '08:00:00', closes: '12:00:00' }])).toEqual({ 1: [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '18:00' }] })
  })
})

describe('parseOptionGroups', () => {
  const group = (o: object = {}) => ({ name: 'Size', min: 1, max: 1, options: [{ name: 'Regular', price: '0' }, { name: 'Large', price: '300' }], ...o })
  it('converts naira to kobo and keeps availability', () => {
    expect(parseOptionGroups(JSON.stringify([group()]))).toEqual({ groups: [{ name: 'Size', min: 1, max: 1, options: [{ name: 'Regular', price_delta_kobo: 0, available: true }, { name: 'Large', price_delta_kobo: 30000, available: true }] }] })
  })
  it('empty input means no options', () => { expect(parseOptionGroups('')).toEqual({ groups: [] }); expect(parseOptionGroups('[]')).toEqual({ groups: [] }) })
  it.each([
    ['not json', /could not be read/], [JSON.stringify({}), /at most 10/], [JSON.stringify(Array(11).fill(group())), /at most 10/],
    [JSON.stringify([group({ name: '' })]), /needs a name/], [JSON.stringify([group({ options: [] })]), /between 1 and 20/],
    [JSON.stringify([group({ min: 2, max: 1 })]), /at most/], [JSON.stringify([group({ max: 5 })]), /cannot exceed/],
    [JSON.stringify([group({ options: [{ name: 'A', price: 'abc' }] })]), /extra price/], [JSON.stringify([group({ options: [{ name: 'A', price: '-5' }] })]), /extra price/],
    [JSON.stringify([group({ options: [{ name: '', price: '0' }] })]), /needs a name/],
  ])('rejects %s', (input, msg) => expect(JSON.stringify(parseOptionGroups(input))).toMatch(msg))
})
