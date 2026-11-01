'use client'
import { ActionForm } from '@/components/forms/action-form'
import { SignaturePad } from '@/components/domain/signature-pad'
import { saveMySignatureAction } from '@/server/modules/identity-and-access/signature-actions'
import { SignatureStatement } from './signature-statement'

export function SignatureSetupForm({ next }: { next: string }) {
  return (
    <ActionForm action={saveMySignatureAction} submitLabel="Save my signature" variant="gold">
      <input type="hidden" name="next" value={next} />
      <SignatureStatement />
      <SignaturePad label="Sign here" />
    </ActionForm>
  )
}
