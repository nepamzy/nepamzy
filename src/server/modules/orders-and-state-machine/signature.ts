/** Validation of a drawn-signature data URL, shared by pickup and delivery completion. Pure: no I/O. */
export const MIN_SIGNATURE_BYTES = 300
export const MAX_SIGNATURE_BYTES = 400_000
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]

export type SignatureCheck =
  | { ok: true; png: Buffer; hex: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'too_large' | 'too_small' | 'not_png' }

export function parseSignature(dataUrl: string): SignatureCheck {
  if (!dataUrl) return { ok: false, reason: 'missing' }
  // base64 inflates by 4/3; refuse before decoding anything oversized
  if (dataUrl.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 64)
    return { ok: false, reason: 'too_large' }
  const m = DATA_URL.exec(dataUrl)
  if (!m) return { ok: false, reason: 'malformed' }
  const png = Buffer.from(m[1]!, 'base64')
  if (png.length > MAX_SIGNATURE_BYTES) return { ok: false, reason: 'too_large' }
  if (png.length < MIN_SIGNATURE_BYTES) return { ok: false, reason: 'too_small' }
  if (!PNG_MAGIC.every((b, i) => png[i] === b)) return { ok: false, reason: 'not_png' }
  return { ok: true, png, hex: '\\x' + png.toString('hex') }
}
