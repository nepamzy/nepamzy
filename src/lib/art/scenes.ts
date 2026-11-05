/**
 * Flat pictures for products and shops that have no photo of their own. Plain SVG text, so one source serves both the
 * public image route (which sends it as an image) and the pages (which draw it inline). Nothing here comes from user input
 * except the kind, which is picked from a fixed list, so it is safe to inline.
 */
export type ArtKind = 'food' | 'drink' | 'print' | 'souvenir' | 'general'

const NAVY = 'rgb(11,42,92)'
const BLUE = 'rgb(23,74,156)'
const GOLD = 'rgb(255,201,40)'
const WHITE = 'rgb(255,255,255)'
const CREAM = 'rgb(255,246,214)'
const RED = 'rgb(200,50,60)'
const ORANGE = 'rgb(232,120,40)'
const GREEN = 'rgb(46,150,90)'

/** Picks a picture for a product from its name and its shop's category. Falls back to the shopping bag. */
export function artKind(name: string, categorySlug?: string | null): ArtKind {
  const t = `${name} ${categorySlug ?? ''}`.toLowerCase()
  if (/drink|water|zobo|juice|soda|coke|malt|tea|coffee|smoothie|beverage|yogurt|milk/.test(t))
    return 'drink'
  if (
    /rice|jollof|chicken|beef|fish|plantain|bun|dish|meal|food|kitchen|snack|egg|bread|pie|suya|soup|stew|noodle|pizza|burger|salad|cake|c2|dodo|beans|yam/.test(
      t,
    )
  )
    return 'food'
  if (/print|copy|binding|poster|photocopy|scan|laminat|document|stationery/.test(t)) return 'print'
  if (/souvenir|gift|notebook|shirt|cap|mug|keyring|bag|hoodie|badge|branded/.test(t))
    return 'souvenir'
  return 'general'
}

const bg = (id: string, w: number, h: number) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${id})"/>`

const dots = `<g fill="${GOLD}" opacity=".25"><circle cx="40" cy="48" r="5"/><circle cx="354" cy="40" r="7"/><circle cx="372" cy="250" r="5"/><circle cx="30" cy="246" r="7"/></g><circle cx="200" cy="160" r="118" fill="${WHITE}" opacity=".07"/>`

const FOOD = `
<ellipse cx="200" cy="232" rx="132" ry="26" fill="rgb(0,0,0)" opacity=".25"/>
<ellipse cx="200" cy="214" rx="128" ry="30" fill="${WHITE}"/>
<ellipse cx="200" cy="210" rx="102" ry="21" fill="${CREAM}"/>
<path d="M118 206c4-52 38-82 82-82s78 30 82 82c-20 22-62 26-82 26s-62-4-82-26z" fill="${ORANGE}"/>
<g fill="${RED}" opacity=".55"><circle cx="160" cy="176" r="5"/><circle cx="196" cy="156" r="5"/><circle cx="232" cy="172" r="5"/><circle cx="214" cy="196" r="5"/><circle cx="174" cy="204" r="5"/></g>
<g fill="${GREEN}"><rect x="146" y="188" width="10" height="4" rx="2"/><rect x="244" y="190" width="10" height="4" rx="2"/><rect x="198" y="176" width="10" height="4" rx="2"/></g>
<g><path d="M262 184c18-30 54-30 62-8 6 18-14 34-32 36l-26 4z" fill="rgb(158,84,32)"/><rect x="316" y="178" width="12" height="12" rx="6" fill="${CREAM}"/><rect x="326" y="182" width="9" height="9" rx="4.5" fill="${CREAM}"/></g>
<g fill="${GOLD}"><ellipse cx="108" cy="198" rx="26" ry="11" transform="rotate(-18 108 198)"/><ellipse cx="136" cy="214" rx="26" ry="11" transform="rotate(-8 136 214)"/></g>
<g stroke="${WHITE}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".7"><path d="M170 108c-8-14 8-22 0-36"/><path d="M200 100c-8-14 8-22 0-36"/><path d="M230 108c-8-14 8-22 0-36"/></g>`

const DRINK = `
<ellipse cx="200" cy="262" rx="86" ry="14" fill="rgb(0,0,0)" opacity=".25"/>
<path d="M142 90h116l-14 164c-1 8-6 12-14 12h-60c-8 0-13-4-14-12z" fill="${WHITE}" opacity=".35"/>
<path d="M150 150h100l-9 104c-1 8-6 12-14 12h-54c-8 0-13-4-14-12z" fill="${RED}"/>
<path d="M150 150h100l-2 22c-18-10-30 8-48 0s-32 10-48 0z" fill="rgb(232,90,100)"/>
<g fill="${WHITE}" opacity=".85"><rect x="166" y="184" width="26" height="26" rx="5" transform="rotate(-12 179 197)"/><rect x="206" y="200" width="26" height="26" rx="5" transform="rotate(10 219 213)"/></g>
<path d="M142 90h116l-3 34H145z" fill="${WHITE}" opacity=".18"/>
<path d="M226 40l12 4-26 116h-9z" fill="${GOLD}"/>
<path d="M226 40l22-14" stroke="${GOLD}" stroke-width="9" stroke-linecap="round" fill="none"/>
<g fill="${WHITE}" opacity=".6"><circle cx="262" cy="112" r="7"/><circle cx="282" cy="140" r="4"/><circle cx="118" cy="130" r="5"/></g>
<path d="M162 100v140" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" opacity=".5"/>`

const PRINT = `
<ellipse cx="200" cy="262" rx="140" ry="14" fill="rgb(0,0,0)" opacity=".25"/>
<g transform="rotate(-6 200 90)"><rect x="132" y="38" width="136" height="104" rx="6" fill="${WHITE}"/><path d="M148 62h104M148 80h104M148 98h70M148 116h92" stroke="${BLUE}" stroke-width="7" stroke-linecap="round"/></g>
<rect x="78" y="128" width="244" height="104" rx="18" fill="${GOLD}"/>
<rect x="78" y="128" width="244" height="30" rx="14" fill="rgb(235,176,10)"/>
<rect x="104" y="170" width="192" height="12" rx="6" fill="${NAVY}"/>
<rect x="118" y="196" width="164" height="62" rx="4" fill="${WHITE}"/>
<path d="M130 212h140M130 226h140M130 240h96" stroke="${BLUE}" stroke-width="6" stroke-linecap="round" opacity=".8"/>
<circle cx="296" cy="146" r="7" fill="${GREEN}"/>
<g fill="${WHITE}" opacity=".5"><rect x="94" y="140" width="40" height="7" rx="3.5"/></g>`

const SOUVENIR = `
<ellipse cx="200" cy="262" rx="130" ry="14" fill="rgb(0,0,0)" opacity=".25"/>
<g transform="rotate(-8 170 160)"><rect x="104" y="64" width="132" height="176" rx="12" fill="${GOLD}"/><rect x="104" y="64" width="26" height="176" rx="10" fill="rgb(235,176,10)"/>
<path d="M156 92h66M156 108h50" stroke="${NAVY}" stroke-width="7" stroke-linecap="round"/>
<path d="m188 164 8 17 19 2-14 13 4 19-17-9-17 9 4-19-14-13 19-2z" fill="${NAVY}"/>
<path d="M214 64v62l12-10 12 10V64" fill="${RED}"/></g>
<g transform="rotate(10 290 200)"><rect x="244" y="156" width="92" height="82" rx="8" fill="${WHITE}"/><rect x="244" y="186" width="92" height="14" fill="${RED}"/><rect x="283" y="156" width="14" height="82" fill="${RED}"/>
<path d="M290 156c-20-26-44-8-26 4zM290 156c20-26 44-8 26 4z" fill="${RED}"/></g>`

const GENERAL = `
<ellipse cx="200" cy="262" rx="110" ry="12" fill="rgb(0,0,0)" opacity=".25"/>
<g fill="none" stroke="${GOLD}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M138 120h124l14 120H124z"/><path d="M170 120v-22a30 30 0 0 1 60 0v22"/></g>`

const BODY: Record<ArtKind, string> = {
  food: FOOD,
  drink: DRINK,
  print: PRINT,
  souvenir: SOUVENIR,
  general: GENERAL,
}

/** The picture for a product without a photo (4:3). */
export function productArtSvg(kind: ArtKind, label = 'No photo yet'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="${label}">${bg(`g-${kind}`, 400, 300)}${dots}${BODY[kind]}</svg>`
}

/** What a shop's window shows, by kind. */
const WINDOW: Record<ArtKind, string> = {
  food: `<g><rect x="96" y="150" width="120" height="14" rx="4" fill="${NAVY}"/><ellipse cx="124" cy="136" rx="22" ry="14" fill="${ORANGE}"/><rect x="104" y="128" width="40" height="8" fill="${WHITE}" opacity=".6"/><ellipse cx="176" cy="138" rx="24" ry="12" fill="${GOLD}"/><path d="M118 112c-6-10 6-14 0-24M176 116c-6-10 6-14 0-24" stroke="${WHITE}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/></g>`,
  drink: `<g><rect x="96" y="150" width="120" height="14" rx="4" fill="${NAVY}"/><path d="M110 112h28l-4 38h-20z" fill="${RED}"/><path d="M152 100h26l-4 50h-18z" fill="${GREEN}"/><path d="M190 120h24l-4 30h-16z" fill="${GOLD}"/></g>`,
  print: `<g><rect x="104" y="116" width="96" height="48" rx="8" fill="${GOLD}"/><rect x="118" y="100" width="62" height="24" fill="${WHITE}"/><path d="M126 108h46" stroke="${BLUE}" stroke-width="4" stroke-linecap="round"/><rect x="120" y="150" width="60" height="22" fill="${WHITE}"/></g>`,
  souvenir: `<g><rect x="100" y="120" width="52" height="44" rx="4" fill="${GOLD}"/><path d="m126 130 5 10 11 1-8 8 2 11-10-5-10 5 2-11-8-8 11-1z" fill="${NAVY}"/><rect x="164" y="132" width="44" height="32" rx="3" fill="${WHITE}"/><rect x="164" y="144" width="44" height="7" fill="${RED}"/></g>`,
  general: `<g fill="none" stroke="${GOLD}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M122 120h66l8 48h-82z"/><path d="M140 120v-12a16 16 0 0 1 32 0v12"/></g>`,
}

/** A shop front (16:7): striped awning, window with goods, door, and an Open sign. Decorative. */
export function shopFrontSvg(kind: ArtKind): string {
  const stripes = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0
      ? `<path d="M${60 + i * 52} 70h52l-6 40h-52z" fill="${GOLD}"/>`
      : `<path d="M${60 + i * 52} 70h52l-6 40h-52z" fill="${WHITE}"/>`,
  ).join('')
  const scallops = Array.from(
    { length: 10 },
    (_, i) => `<path d="M${54 + i * 52} 110q26 22 52 0z" fill="${i % 2 === 0 ? GOLD : WHITE}"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 280" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient></defs>
<rect width="640" height="280" fill="url(#s-${kind})"/>
<circle cx="572" cy="48" r="26" fill="${GOLD}"/>
<g fill="${WHITE}" opacity=".08"><rect x="8" y="90" width="40" height="190" rx="4"/><rect x="590" y="110" width="44" height="170" rx="4"/></g>
<rect x="46" y="64" width="548" height="12" rx="4" fill="${NAVY}"/>
${stripes}${scallops}
<rect x="62" y="132" width="516" height="118" fill="${CREAM}"/>
<rect x="62" y="132" width="516" height="6" fill="${GOLD}"/>
<rect x="78" y="148" width="270" height="86" rx="6" fill="${BLUE}" opacity=".35"/>
<g transform="translate(40 36)">${WINDOW[kind]}</g>
<g transform="translate(150 36) scale(.9)">${WINDOW[kind]}</g>
<rect x="388" y="148" width="86" height="102" rx="6" fill="${NAVY}"/>
<rect x="398" y="158" width="66" height="92" rx="4" fill="${BLUE}"/>
<circle cx="452" cy="206" r="4" fill="${GOLD}"/>
<rect x="494" y="150" width="68" height="34" rx="8" fill="rgb(20,100,56)"/>
<text x="528" y="173" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${WHITE}" text-anchor="middle">OPEN</text>
<rect x="0" y="250" width="640" height="30" fill="${NAVY}"/>
<path d="M0 262h640" stroke="${WHITE}" stroke-width="3" stroke-dasharray="20 16" opacity=".3"/>
<g><rect x="28" y="196" width="10" height="56" fill="rgb(120,78,40)"/><circle cx="33" cy="180" r="26" fill="${GREEN}"/></g>
</svg>`
}
