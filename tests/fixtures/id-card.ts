import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import QRCode from 'qrcode'

/**
 * Made-up student ID card photos for tests (NOT a real card): a cream card with some printed-looking bars, and, for the new
 * card, a QR code on the front. `front-no-qr` stands for the old card.
 */
export async function idCardJpeg(kind: 'front-with-qr' | 'front-no-qr' | 'back'): Promise<Buffer> {
  const W = 900
  const H = 560
  const data = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 245
    data[i * 4 + 1] = 240
    data[i * 4 + 2] = 224
    data[i * 4 + 3] = 255
  }
  const rect = (x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const o = (y * W + x) * 4
        data[o] = rgb[0]
        data[o + 1] = rgb[1]
        data[o + 2] = rgb[2]
      }
  }
  rect(0, 0, W, 90, [11, 42, 92])
  for (let i = 0; i < 7; i++) rect(40, 130 + i * 48, 360 - (i % 3) * 50, 18, [60, 60, 60])
  if (kind === 'front-with-qr') {
    const qr = PNG.sync.read(
      await QRCode.toBuffer('https://example.test/student/FAKE-0001', { width: 300, margin: 2 }),
    )
    for (let y = 0; y < qr.height; y++)
      for (let x = 0; x < qr.width; x++) {
        const s = (y * qr.width + x) * 4
        const o = ((y + 150) * W + (x + 540)) * 4
        data[o] = qr.data[s]!
        data[o + 1] = qr.data[s + 1]!
        data[o + 2] = qr.data[s + 2]!
      }
  } else if (kind === 'back') {
    rect(40, 440, 820, 40, [30, 30, 30])
  }
  return Buffer.from(jpeg.encode({ data, width: W, height: H }, 85).data)
}
