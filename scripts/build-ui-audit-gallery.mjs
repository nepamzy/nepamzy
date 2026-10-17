// Builds the review material for artifacts/afit-market-ui-audit from the capture inventories (never from guesses):
//   gallery.html, page-inventory.md, contact sheets (PNG) and a PDF review report.
//   node scripts/build-ui-audit-gallery.mjs
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = 'artifacts/afit-market-ui-audit'
const load = (phase, vp) => {
  const p = join(ROOT, phase, vp, 'inventory.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}
const rel = (f) => (f ? f.replace(`${ROOT}/`, '') : null)
const maskId = (s) =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '[id]')
    .replace(/\/receipts\/[0-9a-f]{48}/, '/receipts/[token]')
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  )
const key = (r) => `${r.role}/${(r.file ?? '').split('/').pop()}`

const data = {}
for (const phase of ['before', 'after'])
  for (const vp of ['desktop', 'mobile']) {
    data[`${phase}/${vp}`] = new Map(load(phase, vp).map((r) => [key(r), r]))
  }
const keys = [...new Set(Object.values(data).flatMap((m) => [...m.keys()]))].filter(
  (k) => !k.endsWith('/'),
)
const order = { public: 0, customer: 1, vendor: 2, rider: 3, admin: 4 }
keys.sort(
  (a, b) => (order[a.split('/')[0]] ?? 9) - (order[b.split('/')[0]] ?? 9) || a.localeCompare(b),
)
const row = (k) =>
  data['after/desktop'].get(k) ??
  data['after/mobile'].get(k) ??
  data['before/desktop'].get(k) ??
  data['before/mobile'].get(k)
const img = (phase, vp, k) => {
  const r = data[`${phase}/${vp}`].get(k)
  return r?.file
    ? `<a href="${esc(rel(r.file))}"><img loading="lazy" src="${esc(rel(r.file))}" alt="${esc(phase)} ${esc(vp)}: ${esc(k)}"></a>`
    : `<div class="none">not captured</div>`
}

// ---------- gallery.html
const css = `body{font:15px/1.4 system-ui,sans-serif;margin:0;background:#f6f8fc;color:#131c2b}header{padding:16px 20px;background:#10346f;color:#fff}
header p{margin:4px 0 0;color:#d2e1f8}main{padding:16px 20px;max-width:1500px;margin:auto}h2{margin:28px 0 8px;border-bottom:3px solid #f4b400;padding-bottom:4px}
article{background:#fff;border:1px solid #cdd6e4;border-radius:10px;padding:12px;margin:14px 0}article h3{margin:0 0 2px;font-size:16px}
.route{font:13px ui-monospace,monospace;color:#44536a;margin-bottom:8px}.grid{display:grid;grid-template-columns:2fr 1fr;gap:12px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}figcaption{font-size:12px;font-weight:600;margin-bottom:4px;color:#44536a}
img{width:100%;height:auto;border:1px solid #cdd6e4;border-radius:6px;display:block}.none{border:1px dashed #70819c;padding:30px 8px;text-align:center;color:#44536a;font-size:13px}
.note{font-size:12px;color:#7a5400}nav a{margin-right:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}}`
let html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AFIT Market UI audit gallery</title><style>${css}</style>
<header><h1>AFIT Market: UI audit gallery</h1><p>Synthetic local data only. Before = original teal/orange UI; After = provisional blue/gold/red/white palette (not official AFIT colours). Desktop 1440x900, mobile 390x844. ${keys.length} pages/states.</p></header><main><nav>${Object.keys(
  order,
)
  .map((r) => `<a href="#${r}">${r}</a>`)
  .join('')}</nav>`
let cur = ''
for (const k of keys) {
  const role = k.split('/')[0]
  if (role !== cur) {
    cur = role
    html += `<h2 id="${role}">${role[0].toUpperCase() + role.slice(1)}</h2>`
  }
  const r = row(k)
  html += `<article><h3>${esc(r.state)}</h3><div class="route">${esc(maskId(r.route))}${r.note ? `<br><span class="note">${esc(maskId(r.note))}</span>` : ''}</div>
<div class="grid"><div><figure><figcaption>Desktop: before | after</figcaption><div class="cols">${img('before', 'desktop', k)}${img('after', 'desktop', k)}</div></figure></div>
<div><figure><figcaption>Mobile: before | after</figcaption><div class="cols">${img('before', 'mobile', k)}${img('after', 'mobile', k)}</div></figure></div></div></article>`
}
html += `</main></html>`
writeFileSync(join(ROOT, 'gallery.html'), html)

// ---------- page-inventory.md
const yn = (phase, vp, k) => (data[`${phase}/${vp}`].get(k)?.file ? 'yes' : 'NO')
let md = `# Page inventory\n\nBuilt from the capture inventories (\`${ROOT}/{before,after}/{desktop,mobile}/inventory.json\`), i.e. from what was actually rendered, not from a list written by hand. Routes with ids are shown with \`[id]\`. Each row is one page or state; "yes" means a screenshot file exists.\n\n| Role | Route | State | HTTP | Desk before | Desk after | Mob before | Mob after | Note |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`
for (const k of keys) {
  const r = row(k)
  md += `| ${r.role} | \`${maskId(r.route)}\` | ${r.state} | ${r.http ?? ''} | ${yn('before', 'desktop', k)} | ${yn('after', 'desktop', k)} | ${yn('before', 'mobile', k)} | ${yn('after', 'mobile', k)} | ${maskId(r.note ?? '').replace(/\|/g, '/')} |\n`
}
const missing = keys.filter((k) =>
  ['before', 'after'].some((p) =>
    ['desktop', 'mobile'].some((v) => !data[`${p}/${v}`].get(k)?.file),
  ),
)
md += `\nTotal pages/states: ${keys.length}. Missing in at least one of the four captures: ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}.\n`
writeFileSync(join(ROOT, 'page-inventory.md'), md)

// ---------- contact sheets + pdf
const exe = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
].find((p) => p && existsSync(p))
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const pg = await ctx.newPage()
const sheets = []
for (const phase of ['before', 'after'])
  for (const vp of ['desktop', 'mobile']) {
    const list = keys.filter((k) => data[`${phase}/${vp}`].get(k)?.file)
    const w = vp === 'desktop' ? 150 : 70
    const cell = (k) =>
      `<div style="width:${w}px"><img style="width:100%;height:${vp === 'desktop' ? 100 : 130}px;object-fit:cover;object-position:top;border:1px solid #cdd6e4" src="${esc(data[`${phase}/${vp}`].get(k).file.split('/').slice(1).join('/'))}"><div style="font:8px system-ui;overflow:hidden;height:22px">${esc(k.replace(/__/g, ' / ').replace('.png', ''))}</div></div>`
    const sheetHtml = `<!doctype html><body style="margin:8px;background:#fff"><h3 style="font:bold 14px system-ui">${phase} / ${vp} (${list.length} pages)</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${list.map(cell).join('')}</div>`
    const base = join(ROOT, `_sheet-${phase}-${vp}.html`)
    writeFileSync(base, sheetHtml.replaceAll('src="', `src="${phase}/${vp}/`))
    await pg.goto('file://' + join(process.cwd(), base))
    await pg.waitForLoadState('load')
    const out = join(ROOT, `contact-sheet-${phase}-${vp}.png`)
    await pg.screenshot({ path: out, fullPage: true })
    sheets.push(out)
  }
// PDF review report: summary + contact sheets + key before/after pairs
const KEY = keys
  .filter((k) =>
    /(home__landing|vendors__list|checkout__checkout-form|orders__order-history|pay-delivery-fee-details|confirmed-with-receipt|public-receipt-check|vendor__.*dashboard|vendor-earnings|rider__.*dashboard-active|rider-payments|admin__admin__platform-admin|dispute-awaiting-decision|settlements)/.test(
      k,
    ),
  )
  .slice(0, 14)
const pdfHtml = `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:10mm}body{font:12px system-ui;color:#131c2b}h1{color:#10346f}h2{border-bottom:3px solid #f4b400;margin-top:18px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #cdd6e4;padding:3px 6px;font-size:11px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;page-break-inside:avoid;margin-bottom:10px}</style>
<h1>AFIT Market visual review</h1><p>Synthetic local data only. Provisional palette (blue, gold, red, white): <b>not official AFIT colours</b>; no crest used. ${keys.length} pages/states captured at desktop 1440x900 and mobile 390x844, before and after the colour change. Full browsable gallery: gallery.html. File inventory: page-inventory.md.</p>
<h2>Palette</h2><table><tr><th>Role</th><th>Hex</th></tr><tr><td>Blue 700 / 800 / 600</td><td>#174a9c / #10346f / #1d57b8</td></tr><tr><td>Gold (decorative)</td><td>#f4b400</td></tr><tr><td>Gold text pair</td><td>#7a5400 on #fff4cf</td></tr><tr><td>Red</td><td>#a3211a (bg #fdebe9)</td></tr><tr><td>White / surface</td><td>#ffffff / #f6f8fc</td></tr></table>
<h2>Key pages: before | after (desktop)</h2>${KEY.map((k) => `<div class="pair"><div><b>before</b> ${esc(k)}${img('before', 'desktop', k).replaceAll('href="', 'data-h="').replaceAll('src="', `src="file://${process.cwd()}/${ROOT}/`)}</div><div><b>after</b>${img('after', 'desktop', k).replaceAll('href="', 'data-h="').replaceAll('src="', `src="file://${process.cwd()}/${ROOT}/`)}</div></div>`).join('')}
<h2>Contact sheets (after)</h2>${['desktop', 'mobile'].map((v) => `<img src="file://${process.cwd()}/${ROOT}/contact-sheet-after-${v}.png">`).join('')}`
writeFileSync(join(ROOT, '_review.html'), pdfHtml)
await pg.goto('file://' + join(process.cwd(), ROOT, '_review.html'))
await pg.waitForLoadState('load')
await pg.pdf({ path: join(ROOT, 'visual-review-report.pdf'), format: 'A4', printBackground: true })
await browser.close()
for (const p of [
  'gallery.html',
  'page-inventory.md',
  'visual-review-report.pdf',
  ...sheets.map((s) => s.replace(`${ROOT}/`, '')),
])
  console.log(p, Math.round(statSync(join(ROOT, p)).size / 1024) + ' KB')
console.log(`pages/states: ${keys.length}; missing in some capture: ${missing.length}`)
