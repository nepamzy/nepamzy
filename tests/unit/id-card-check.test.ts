import { describe, expect, it } from 'vitest'
import { jpegHasQr, normalizePhone } from '@/server/modules/identity-and-access/id-card-check'
import { idCardJpeg } from '../fixtures/id-card'

describe('the new rider ID card check', () => {
  it('accepts a front photo with a readable QR code, refuses one without (the old card), and refuses junk', async () => {
    expect(jpegHasQr(await idCardJpeg('front-with-qr'))).toBe(true)
    expect(jpegHasQr(await idCardJpeg('front-no-qr'))).toBe(false)
    expect(jpegHasQr(await idCardJpeg('back'))).toBe(false)
    expect(jpegHasQr(Buffer.from('not a picture at all'))).toBe(false)
    expect(jpegHasQr(Buffer.alloc(0))).toBe(false)
  })

  it('reads Nigerian mobile numbers however they are typed and refuses the rest', () => {
    expect(normalizePhone('0803 123 4567')).toBe('+2348031234567')
    expect(normalizePhone('+234 803 123 4567')).toBe('+2348031234567')
    expect(normalizePhone('2348031234567')).toBe('+2348031234567')
    expect(normalizePhone('0911-593-0445')).toBe('+2349115930445')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('0603 123 4567')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})
