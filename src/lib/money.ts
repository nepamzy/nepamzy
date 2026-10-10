/** Money is stored as integer kobo (1 NGN = 100 kobo). Never use floats for money. */
export function formatNaira(kobo: number | bigint): string {
  const k = typeof kobo === 'bigint' ? kobo : BigInt(Math.trunc(kobo))
  if (typeof kobo === 'number' && !Number.isInteger(kobo)) throw new RangeError('kobo must be an integer')
  const negative = k < 0n
  const abs = negative ? -k : k
  const naira = abs / 100n
  const rem = abs % 100n
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}₦${grouped}${rem === 0n ? '' : '.' + rem.toString().padStart(2, '0')}`
}
