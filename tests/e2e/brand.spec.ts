import { expect, test } from '@playwright/test'

test('the AFIT Market logo is used for the browser tab, the installed app and link previews', async ({
  page,
  request,
}) => {
  await page.goto('/')
  // header: the mark and the name written out as text
  const logo = page.locator('header').getByRole('link', { name: 'AFIT Market home' }).first()
  await expect(logo.locator('img[src="/brand/mark.png"]')).toBeVisible()
  await expect(logo).toContainText('AFIT')
  await expect(logo).toContainText('MARKET')
  const head = await page.evaluate(() => ({
    icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(
      (l) => (l as HTMLLinkElement).href,
    ),
    og: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    twitter: document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? '',
    card: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
  }))
  expect(head.icons.length).toBeGreaterThanOrEqual(2)
  expect(head.og).toMatch(/opengraph-image/)
  expect(head.twitter).toMatch(/twitter-image/)
  expect(head.card).toBe('summary_large_image')
  expect(head.ogTitle).toContain('AFIT Market')
  for (const url of [...head.icons, head.og, head.twitter]) {
    const r = await request.get(new URL(url).pathname + new URL(url).search)
    expect(r.status(), url).toBe(200)
    expect(r.headers()['content-type'], url).toMatch(/image\//)
  }
  // installed app: every icon in the manifest exists
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3)
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  for (const i of manifest.icons as { src: string; type: string }[]) {
    const r = await request.get(i.src)
    expect(r.status(), i.src).toBe(200)
    expect(r.headers()['content-type']).toContain(i.type)
  }
  // e-mails and receipts load the same logo files
  expect((await request.get('/brand/mark.png')).status()).toBe(200)
  expect((await request.get('/brand/logo-full.png')).status()).toBe(200)
})
