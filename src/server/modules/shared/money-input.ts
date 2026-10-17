/** "1500" or "1,500.50" naira -> integer kobo, or null when not a valid amount (max N99,999,999.99). */
export function nairaToKobo(input: string): number | null {
  const s = input.replace(/[₦,\s]/g, '')
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null
  const [n, k = ''] = s.split('.')
  return Number(n) * 100 + Number(k.padEnd(2, '0'))
}
