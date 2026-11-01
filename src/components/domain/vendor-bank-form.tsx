'use client'
import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Input, Select } from '@/components/ui/fields'
import {
  lookupVendorBankAction,
  saveVendorBankAction,
  unlockVendorBankAction,
  type BankLookup,
} from '@/server/modules/vendors-and-catalogue/bank-actions'

/** Pick the bank, type the number; the bank's own name for the account appears in bold capitals; then Verify. */
export function VendorBankForm({ banks }: { banks: { name: string; code: string }[] }) {
  const [code, setCode] = useState('')
  const [number, setNumber] = useState('')
  const [found, setFound] = useState<BankLookup | null>(null)
  const [busy, setBusy] = useState(false)

  // Looks the account up as soon as a bank is chosen and 10 digits are typed.
  function check(nextCode: string, nextNumber: string) {
    setCode(nextCode)
    setNumber(nextNumber)
    setFound(null)
    if (!nextCode || !/^[0-9]{10}$/.test(nextNumber)) return
    setBusy(true)
    lookupVendorBankAction(nextCode, nextNumber)
      .then((r) => setFound(r))
      .finally(() => setBusy(false))
  }

  if (banks.length === 0)
    return (
      <p role="status" className="text-muted">
        Bank checking is not available right now. Please come back later.
      </p>
    )
  return (
    <ActionForm
      action={saveVendorBankAction}
      submitLabel="Verify"
      pendingLabel="Verifying…"
      variant="gold"
      hideSubmit={!(found && found.ok)}
    >
      <Select
        label="Bank"
        name="bank_code"
        required
        value={code}
        onChange={(e) => check(e.target.value, number)}
      >
        <option value="">Choose your bank</option>
        {banks.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </Select>
      <Input
        label="Account number"
        name="account_number"
        required
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{10}"
        maxLength={10}
        value={number}
        onChange={(e) => check(code, e.target.value.replace(/\D/g, ''))}
        hint="10 digits."
      />
      <div aria-live="polite" className="min-h-8">
        {busy && <p className="text-muted">Checking the account…</p>}
        {found?.ok && (
          <p data-testid="resolved-name">
            <span className="block text-sm text-muted">Account name from the bank</span>
            <strong className="text-xl uppercase tracking-wide">{found.name}</strong>
          </p>
        )}
        {found && !found.ok && <p className="font-medium text-danger-700">{found.message}</p>}
      </div>
      <p className="text-sm text-muted">
        Once verified, the account cannot be changed unless you contact customer service.
      </p>
    </ActionForm>
  )
}

export function UnlockVendorBankForm({ vendorId }: { vendorId: string }) {
  return (
    <ActionForm
      action={unlockVendorBankAction}
      submitLabel="Unlock payout account"
      pendingLabel="Unlocking…"
    >
      <input type="hidden" name="vendorId" value={vendorId} />
      <Input label="Reason (required)" name="reason" required minLength={5} maxLength={300} />
    </ActionForm>
  )
}
