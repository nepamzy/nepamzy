'use server'

import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FieldCryptoError, encryptField } from '@/server/security/field-crypto'
import { rateLimit } from '@/server/modules/identity-and-access/security'
import {
  PaymentsUnavailable,
  listBanks,
  resolveAccountName,
} from '@/server/modules/payments/paystack'
import {
  dbFailed,
  done,
  failed,
  gate,
  text,
  type ActionState,
} from '@/server/modules/shared/action-helpers'
import { getMyVendor } from './vendor-queries'

const OWNER = { roles: ['vendor_owner' as const], aal: 'aal2' as const }

export type BankLookup = { ok: true; name: string } | { ok: false; message: string }

/** The bank list for the picker. Empty when bank checks are not available. */
export async function vendorBankChoices(): Promise<{ name: string; code: string }[]> {
  try {
    return await listBanks()
  } catch {
    return []
  }
}

/** Asks the bank (through Paystack) whose account this is. The answer is only shown; saving asks again. */
export async function lookupVendorBankAction(
  bankCode: string,
  number: string,
): Promise<BankLookup> {
  const g = await gate(OWNER)
  if ('state' in g) return { ok: false, message: 'Please sign in as the shop owner.' }
  if (!/^[0-9]{10}$/.test(number))
    return { ok: false, message: 'The account number must be 10 digits.' }
  if (!/^[0-9A-Za-z-]{2,12}$/.test(bankCode)) return { ok: false, message: 'Choose your bank.' }
  if (!(await rateLimit(`vbank-lookup:${g.who.userId}`, 3600, 20)))
    return { ok: false, message: 'Too many lookups. Please try again later.' }
  try {
    const name = await resolveAccountName(number, bankCode)
    return name
      ? { ok: true, name }
      : { ok: false, message: 'We could not find that account. Check the bank and the number.' }
  } catch (e) {
    if (!(e instanceof PaymentsUnavailable)) logger.error('bank lookup failed', {})
    return {
      ok: false,
      message: 'Account checking is not available right now. Please try again later.',
    }
  }
}

export async function saveVendorBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate(OWNER)
  if ('state' in g) return g.state
  const me = await getMyVendor()
  if (!me || me.staff_role !== 'owner') return failed('Only the shop owner can do this.')
  if (!(await rateLimit(`vbank-save:${g.who.userId}`, 3600, 10)))
    return failed('Too many tries. Please try again later.')
  const number = text(fd, 'account_number', 20).replace(/\s/g, '')
  const bankCode = text(fd, 'bank_code', 12)
  if (!/^[0-9]{10}$/.test(number)) return failed('The account number must be 10 digits.')
  // The name is asked again here and comes from the bank, never from the browser.
  const banks = await vendorBankChoices()
  const bank = banks.find((b) => b.code === bankCode)
  if (!bank) return failed('Choose your bank from the list.')
  let name: string | null
  try {
    name = await resolveAccountName(number, bank.code)
  } catch {
    return failed('Account checking is not available right now. Please try again later.')
  }
  if (!name) return failed('We could not find that account. Check the bank and the number.')
  let cipher: string
  try {
    cipher = encryptField(number)
  } catch (e) {
    logger.error('vendor bank not saved: encryption unavailable', {
      code: e instanceof FieldCryptoError ? e.code : 'unknown',
    })
    return failed('The account cannot be saved right now. Please try again later.')
  }
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('vendor_save_bank', {
    p_vendor: me.id,
    p_bank_code: bank.code,
    p_bank_name: bank.name,
    p_cipher: cipher,
    p_last4: number.slice(-4),
    p_name: name,
  })
  if (error) {
    if (error.message.includes('bank_locked'))
      return failed('This account is already verified. To change it, contact customer service.')
    return dbFailed(error, 'The account could not be saved. Please try again.')
  }
  revalidatePath('/vendor/earnings')
  return done('Verified and saved.')
}

export async function unlockVendorBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const g = await gate({ roles: ['platform_admin'], aal: 'aal2' })
  if ('state' in g) return g.state
  const sb = await createSupabaseServerClient()
  const { error } = await sb.rpc('admin_unlock_vendor_bank', {
    p_vendor: text(fd, 'vendorId', 40),
    p_reason: text(fd, 'reason', 300),
  })
  if (error) return dbFailed(error, 'Give a reason of at least 5 characters, then try again.')
  revalidatePath('/admin/vendors')
  return done('Unlocked. The shop owner can now enter the account again.')
}
