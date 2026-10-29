import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { ADMIN_NAV, CUSTOMER_NAV, VENDOR_NAV } from '@/components/shells/nav-config'

const css = readFileSync('src/app/globals.css', 'utf8')
const token = (n: string) => css.match(new RegExp(`--color-${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('control borders meet 3:1 (WCAG 1.4.11) on every background they sit on', () => {
  it.each([
    ['card', '#ffffff'],
    ['surface', token('surface')],
    ['brand-50', token('brand-50')],
  ])('line-strong against %s', (_n, bg) => {
    expect(ratio(token('line-strong'), bg)).toBeGreaterThanOrEqual(3)
  })
  it('text pairs stay at 4.5:1 or better', () => {
    expect(ratio(token('ink'), token('surface'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#ffffff', token('brand-700'))).toBeGreaterThanOrEqual(4.5)
  })
  it('provisional palette (blue / gold / red): text and status pairs meet 4.5:1, decorative gold stays out of text', () => {
    expect(ratio('#ffffff', token('brand-800'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('brand-700'), token('brand-50'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('accent-700'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('accent-600'), token('accent-50'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('warning-700'), token('warning-50'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('danger-700'), token('danger-50'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('success-700'), token('success-50'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('info-700'), token('info-50'))).toBeGreaterThanOrEqual(4.5)
    // navy surfaces (Administration sidebar, footer, auth panel): light text and gold accents stay readable
    expect(ratio('#ffffff', token('navy-900'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('navy-text'), token('navy-900'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('navy-text'), token('navy-800'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('gold-400'), token('navy-900'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#ffffff', token('danger-700'))).toBeGreaterThanOrEqual(4.5)
    // gold is a fill: dark ink on gold passes, so any label placed on it is readable
    expect(ratio(token('ink'), token('gold-400'))).toBeGreaterThanOrEqual(4.5)
    // keyboard focus ring (brand-600) is visible against the page surface and white
    expect(ratio(token('brand-600'), token('surface'))).toBeGreaterThanOrEqual(3)
  })
  it('no component hard-codes the old teal or any raw hex colour outside the token file, the signature pad and the e-mail template', () => {
    const files = execSync(
      "grep -rlE '#[0-9a-fA-F]{6}' src --include=*.tsx --include=*.ts --include=*.css",
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    expect(files.sort()).toEqual([
      'src/app/globals.css',
      'src/app/layout.tsx',
      'src/app/manifest.ts',
      'src/components/domain/signature-pad.tsx',
      // e-mail clients cannot use CSS variables, so the brand colours are written out in the message template
      'src/server/modules/engagement/email-templates.ts',
    ])
  })
})

describe('phone navigation: every destination is reachable', () => {
  it('shells with more than five items have a menu page listing all of them', () => {
    for (const [items, page] of [
      [ADMIN_NAV, 'src/app/admin/menu/page.tsx'],
      [VENDOR_NAV, 'src/app/vendor/menu/page.tsx'],
    ] as const) {
      expect(items.length).toBeGreaterThan(5)
      expect(existsSync(page)).toBe(true)
      expect(readFileSync(page, 'utf8')).toContain('NavMenu')
    }
    expect(CUSTOMER_NAV.length).toBeLessThanOrEqual(5)
  })
  it('previously unreachable destinations are in the navigation', () => {
    const admin = ADMIN_NAV.map((i) => i.href)
    for (const h of [
      '/admin/delivery-points',
      '/admin/categories',
      '/admin/returns',
      '/admin/settlements',
    ])
      expect(admin).toContain(h)
    const vendor = VENDOR_NAV.map((i) => i.href)
    for (const h of ['/vendor/returns', '/vendor/handover', '/vendor/earnings'])
      expect(vendor).toContain(h)
  })
  it('no duplicate links and every linked page exists', () => {
    for (const items of [ADMIN_NAV, VENDOR_NAV, CUSTOMER_NAV]) {
      const hrefs = items.map((i) => i.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
      for (const h of hrefs)
        expect(
          existsSync(`src/app${h}/page.tsx`) || existsSync(`src/app/(public)${h}/page.tsx`),
          h,
        ).toBe(true)
    }
  })
})

describe('copy that must not make claims we cannot support', () => {
  it('the landing page and metadata do not claim AFIT approval; the vendor page no longer says orders cannot be handled', () => {
    for (const f of ['src/app/(public)/page.tsx', 'src/app/layout.tsx'])
      expect(readFileSync(f, 'utf8')).not.toMatch(/approved (AFIT|campus)/i)
    expect(readFileSync('src/app/vendor/page.tsx', 'utf8')).not.toMatch(
      /arrives in the next release/i,
    )
  })
})

describe('mobile header cannot overflow sideways', () => {
  it('keeps words whole but lets the header wrap to a second row instead of scrolling', () => {
    const src = readFileSync('src/components/shells/app-shell.tsx', 'utf8')
    expect(src).toMatch(/<header className="[^"]*flex flex-wrap /)
    // the phone header shows only the logo mark below 420px so icons never push the page sideways
    expect(src).toContain('compact')
  })
})
