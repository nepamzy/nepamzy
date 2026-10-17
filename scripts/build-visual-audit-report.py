#!/usr/bin/env python3
"""Builds the route inventory (CSV/MD), the visual audit Markdown report and the HTML used for the PDF, from the capture
inventories written by tests/visual-audit/capture.spec.ts. Pure reporting: it changes nothing in the application."""
import csv, glob, html, json, os, re, subprocess, sys
from PIL import Image

ROOT = 'docs/reports/afit-market-visual-audit'
HEAD = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip()
BRANCH = subprocess.check_output(['git', 'branch', '--show-current']).decode().strip()
DATE = sys.argv[1] if len(sys.argv) > 1 else '2026-10-12'
VPS = ['mobile-360x800', 'desktop-1440x900']
data = {v: json.load(open(f'{ROOT}/inventory-{v}.json')) for v in VPS}

# ---------- discovered pages (from the App Router) ----------
pages = []
for dp, _, fs in os.walk('src/app'):
    if 'page.tsx' in fs:
        r = dp[len('src/app'):] or '/'
        r = re.sub(r'/\([^)]*\)', '', r) or '/'
        pages.append(r)
pages = sorted(set(pages))
ROLE = {
    '/': 'public', '/vendors': 'public', '/vendors/[slug]': 'public', '/products/[id]': 'public', '/login': 'public',
    '/signup': 'public', '/offline': 'public', '/design': 'public (design reference)', '/mfa/enroll': 'any signed-in (aal1+)',
    '/mfa/challenge': 'any signed-in with a factor', '/cart': 'customer (aal1)', '/checkout': 'customer (aal2)',
    '/orders': 'customer (aal2)', '/orders/[id]': 'customer (aal2)', '/orders/[id]/help': 'customer (aal2)',
    '/account': 'any user (aal2)', '/account/security': 'any user (aal2)', '/notifications': 'any user (aal2)',
    '/cases': 'any party (aal2)', '/cases/[id]': 'any party (aal2)', '/apply': 'customer (aal2)',
    '/rider-apply': 'customer (aal2)',
}
def role_of(p):
    if p.startswith('/admin'):
        return {'/admin/roles': 'platform_admin', '/admin/applications': 'platform_admin', '/admin/vendors': 'platform_admin',
                '/admin/delivery-points': 'platform_admin', '/admin/categories': 'platform_admin', '/admin/riders': 'platform_admin',
                '/admin/jobs': 'platform_admin', '/admin/settings': 'platform_admin',
                '/admin/payments': 'platform_admin, finance_admin', '/admin/refunds': 'platform_admin, support_agent, finance_admin',
                '/admin': 'platform_admin, support_agent, finance_admin'}.get(p, 'platform_admin, support_agent') + ' (aal2)'
    if p.startswith('/vendor'): return 'vendor_owner / vendor_staff (aal2)'
    if p.startswith('/rider'): return 'rider (aal2)'
    return ROLE.get(p, '?')

def norm(route):
    r = route.split('?')[0]
    r = re.sub(r'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '/[id]', r)
    r = re.sub(r'^/vendors/(?!no-such)[^/]+$', '/vendors/[slug]', r)
    if r.startswith('/vendors/no-such'): r = '/vendors/[slug]'
    r = r.replace('/products/[id]', '/products/[id]')
    return r
def pattern_of(page):  # normalise discovered page for comparison
    return page.replace('/orders/[id]/receipt', '/orders/[id]/receipt')

captured_by_route = {}
for v in VPS:
    for x in data[v]:
        if x['file']:
            captured_by_route.setdefault(norm(x['route']), set()).add(v)
# vendor catalogue/[id]
disc = []
for p in pages:
    ok = captured_by_route.get(p, set())
    disc.append((p, role_of(p), sorted(ok)))
total_routes = len(disc)
captured_routes = sum(1 for _, _, ok in disc if len(ok) == 2)
partial = [d for d in disc if 0 < len(d[2]) < 2]
missing = [d for d in disc if len(d[2]) == 0]

# ---------- state rows (pair mobile/desktop by role+route-normalised+state) ----------
def key(x): return (x['role'], norm(x['route']), x['state'])
by = {}
for v in VPS:
    for x in data[v]:
        by.setdefault(key(x), {})[v] = x
rows = sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2]))
n_states = len(rows)
n_images = sum(1 for v in VPS for x in data[v] if x['file'])

# ---------- CSV + MD inventory ----------
with open(f'{ROOT}/route-inventory.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['role_folder', 'route_pattern', 'state', 'intended_roles', 'http_status', 'final_path', 'mobile_360x800_png', 'desktop_1440x900_png', 'capture_status', 'note'])
    for (role, route, state), d in rows:
        m, dk = d.get('mobile-360x800'), d.get('desktop-1440x900')
        any_ = m or dk
        status = 'captured' if (m and m['file'] and dk and dk['file']) else 'PARTIAL/FAILED'
        w.writerow([role, route, state, role_of(route), any_['http'] if any_['http'] is not None else '', any_['actualUrl'],
                    (m or {}).get('file') or '', (dk or {}).get('file') or '', status, (any_['note'] or '').strip()])
with open(f'{ROOT}/route-inventory.md', 'w') as f:
    f.write('# Route inventory (generated from the capture run)\n\n')
    f.write(f'Audit date {DATE}; HEAD `{HEAD}`; branch `{BRANCH}`.\n\n')
    f.write('## A. Every user-facing page found in the App Router\n\n')
    f.write(f'{total_routes} page routes were found under `src/app` (`page.tsx` files). Dynamic segments are shown as `[id]`/`[slug]`; the capture used synthetic records for them.\n\n')
    f.write('| Route | Intended role(s) | Captured at | \n| --- | --- | --- |\n')
    for p, r, ok in disc:
        f.write(f"| `{p}` | {r} | {', '.join(ok) if ok else '**NOT CAPTURED**'} |\n")
    f.write('\nNon-page endpoints (not screenshotted, they render no interface): `/api/health`, `/api/jobs/*` (4), `/api/orders/[id]/tracking`, `/api/payments/return`, `/api/webhooks/paystack`, `/auth/confirm`, `/orders/[id]/receipt` (PDF download).\n\n')
    f.write('## B. Every captured page and state\n\n| Role folder | Route | State | HTTP | Final path | Mobile 360x800 | Desktop 1440x900 | Note |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n')
    for (role, route, state), d in rows:
        m, dk = d.get('mobile-360x800'), d.get('desktop-1440x900')
        a = m or dk
        f.write(f"| {role} | `{route}` | {state} | {a['http'] if a['http'] is not None else ''} | `{a['actualUrl'].split('?')[0]}` | "
                f"[png]({os.path.relpath((m or {}).get('file',''), 'docs/reports/afit-market-visual-audit') if m and m['file'] else ''}) | "
                f"[png]({os.path.relpath((dk or {}).get('file',''), 'docs/reports/afit-market-visual-audit') if dk and dk['file'] else ''}) | {(a['note'] or '').strip()} |\n")
print('routes', total_routes, 'fully captured', captured_routes, 'partial', len(partial), 'missing', [m[0] for m in missing])
print('states', n_states, 'images', n_images)
json.dump({'total_routes': total_routes, 'captured_routes': captured_routes, 'states': n_states, 'images': n_images,
           'missing': [m[0] for m in missing], 'partial': [p[0] for p in partial]}, open(f'{ROOT}/_summary.json', 'w'))

# ---------- preview JPEGs for the PDF (originals untouched) ----------
PREV = '/tmp/afit-previews'; os.makedirs(PREV, exist_ok=True)
def preview(path, width, maxh):
    if not path: return None, False
    im = Image.open(path).convert('RGB')
    h = int(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    cropped = h > maxh
    if cropped: im = im.crop((0, 0, width, maxh))
    out = os.path.join(PREV, re.sub(r'[^A-Za-z0-9]+', '_', path) + '.jpg')
    im.save(out, quality=72)
    return out, cropped

def esc(s): return html.escape(str(s))
h = ['<!doctype html><meta charset="utf-8"><title>AFIT Market visual audit</title><style>',
     '@page{size:A4 landscape;margin:12mm} body{font:12px/1.45 system-ui,sans-serif;color:#16211f} h1{font-size:26px} h2{font-size:18px;border-bottom:2px solid #0b5551;padding-bottom:3px}',
     'h3{font-size:13px;margin:0 0 4px} table{border-collapse:collapse;width:100%;font-size:10.5px} td,th{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}',
     '.pg{page-break-after:always} .shots{display:flex;gap:14px;align-items:flex-start} .shots figure{margin:0} .shots img{display:block;border:1px solid #bbb}',
     'figcaption{font-size:9.5px;color:#444;margin-top:2px} .sw{display:inline-block;width:46px;height:20px;border:1px solid #888;vertical-align:middle} code{font-size:10px}',
     '.warn{background:#fff3d6;border:1px solid #c9a227;padding:6px 8px} </style>']
# cover
h.append(f'<div class="pg"><h1>AFIT Market: visual audit of the existing application</h1><p><b>Audit date:</b> {DATE}<br><b>Repository revision:</b> <code>{HEAD}</code> (branch <code>{BRANCH}</code>)<br><b>Environment:</b> local Supabase stack + local production build, SYNTHETIC data only. Nothing deployed.</p>')
h.append(f'<p class="warn"><b>Status:</b> observation only. No colour, layout or design change has been made or is proposed for immediate implementation. <b>WAIT FOR OWNER REVIEW BEFORE APPLYING COLOUR OR DESIGN CHANGES.</b></p>')
h.append(f'<h2>Summary</h2><ul><li>{total_routes} user-facing page routes found; {captured_routes} captured at both viewports; {len(partial)} partially; {len(missing)} not captured.</li><li>{n_states} page states captured at 360x800 and 1440x900 = {n_images} original PNG files.</li><li><b>Admin side: IMPLEMENTED and working</b> (16 pages + case detail; reachable only with the right role and a completed TOTP step; real local data).</li><li>Current palette is a <b>teal-green</b> (brand #0b5551) with a burnt-orange accent. AFIT crest colours (blue, gold, red, white per the project hand-off) are <b>not</b> used, and no crest/logo appears in the app.</li><li>AFIT\'s website could not be reached from this sandbox (proxy returned 403), so <b>no colour was sampled</b> and <b>no official hex value is claimed</b>.</li></ul></div>')
SECTIONS = json.load(open('/tmp/afit-sections.json'))
for title, body in SECTIONS['pdf']:
    h.append(f'<div class="pg"><h2>{esc(title)}</h2>{body}</div>')
# screenshots, one page per state
for (role, route, state), d in rows:
    m, dk = d.get('mobile-360x800'), d.get('desktop-1440x900')
    a = m or dk
    pm, cm = preview((m or {}).get('file'), 270, 560)
    pd, cd = preview((dk or {}).get('file'), 660, 560)
    h.append(f'<div class="pg"><h3>{esc(role)} · <code>{esc(route)}</code> · {esc(state)}</h3><p style="margin:0 0 6px">HTTP {esc(a["http"])} · final path <code>{esc(a["actualUrl"].split("?")[0])}</code> · intended: {esc(role_of(route))} {esc((a["note"] or "").strip())}</p><div class="shots">')
    for lab, p, c, f in (('Mobile 360x800', pm, cm, (m or {}).get('file')), ('Desktop 1440x900', pd, cd, (dk or {}).get('file'))):
        if p:
            h.append(f'<figure><img src="file://{p}"><figcaption>{lab}{" (top portion shown; full-page PNG: " + esc(f) + ")" if c else " (full page)"}<br>{esc(f)}</figcaption></figure>')
        else:
            h.append(f'<figure><b>{lab}: not captured</b></figure>')
    h.append('</div></div>')
open('/tmp/afit-audit.html', 'w').write('\n'.join(h))
print('html written')
