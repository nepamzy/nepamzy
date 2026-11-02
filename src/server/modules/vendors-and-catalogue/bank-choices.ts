import 'server-only'
import { listBanks } from '@/server/modules/payments/paystack'

/** The bank list for the picker. Empty when bank checks are not available. */
export async function vendorBankChoices(): Promise<{ name: string; code: string }[]> {
  try {
    return await listBanks()
  } catch {
    return []
  }
}
