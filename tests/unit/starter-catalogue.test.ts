import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STARTER_ITEMS, categoryOf, sectionsOf, startersFor } from '@/lib/starter-catalogue'

describe('ready-made catalogue', () => {
  it('has unique slugs and sensible text', () => {
    const slugs = STARTER_ITEMS.map((i) => i.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const i of STARTER_ITEMS) {
      expect(i.slug).toMatch(/^[a-z0-9-]{2,60}$/)
      expect(i.name.length).toBeGreaterThanOrEqual(2)
      expect(i.name.length).toBeLessThanOrEqual(80)
      expect(i.description.length).toBeLessThanOrEqual(300)
      expect(i.section.length).toBeLessThanOrEqual(40)
    }
  })

  it('food and drinks shops see both lists; other categories see their own only', () => {
    const food = startersFor('food').map(categoryOf)
    expect(new Set(food)).toEqual(new Set(['food', 'drinks']))
    expect(new Set(startersFor('drinks').map(categoryOf))).toEqual(new Set(['food', 'drinks']))
    for (const c of ['clothing', 'gadgets', 'games', 'printing', 'souvenirs', 'accessories']) {
      const items = startersFor(c)
      expect(items.length, c).toBeGreaterThan(3)
      expect(
        items.every((i) => (c === 'printing' ? categoryOf(i) === 'printing' : categoryOf(i) === c)),
      ).toBe(true)
    }
  })

  it('gives a shop with several categories the lists of all of them', () => {
    const both = startersFor(['clothing', 'gadgets']).map(categoryOf)
    expect(new Set(both)).toEqual(new Set(['clothing', 'gadgets']))
    expect(startersFor(['clothing', 'food']).length).toBe(
      startersFor('clothing').length + startersFor('food').length,
    )
    expect(startersFor(['clothing', 'clothing']).length).toBe(startersFor('clothing').length)
  })

  it('knows a spelling slip in a category name, and gives nothing for an unknown category', () => {
    expect(startersFor('acccessories').length).toBeGreaterThan(0)
    expect(startersFor('farm-animals')).toEqual([])
    expect(startersFor(null)).toEqual([])
  })

  it('lists sections in first-seen order', () => {
    expect(sectionsOf(startersFor('clothing'))).toEqual(['Tops', 'Bottoms', 'Shoes'])
  })

  it('marks an item as having a photo exactly when its file exists', () => {
    const files = new Set(readdirSync('public/catalogue').map((f) => f.replace(/\.jpg$/, '')))
    for (const i of STARTER_ITEMS)
      expect(Boolean(i.photo), i.slug).toBe(existsSync(`public/catalogue/${i.slug}.jpg`))
    for (const f of files)
      expect(
        STARTER_ITEMS.some((i) => i.slug === f),
        `${f}.jpg has no item`,
      ).toBe(true)
  })
})
