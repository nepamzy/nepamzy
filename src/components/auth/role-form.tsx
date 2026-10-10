'use client'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/fields'
import { changeRoleAction, type RoleFormState } from '@/server/modules/identity-and-access/admin-actions'

export function RoleForm() {
  const [state, action, pending] = useActionState<RoleFormState, FormData>(changeRoleAction, {})
  return (
    <form action={action} className="space-y-4">
      {state.error && <p role="alert" className="font-semibold text-danger-700">{state.error}</p>}
      {state.message && <p role="status" className="font-semibold text-success-700">{state.message}</p>}
      <Input label="User ID" name="userId" required pattern="[0-9a-fA-F-]{36}" hint="The account’s unique ID (shown in the audit trail)." />
      <Select label="Role" name="role" required defaultValue="">
        <option value="" disabled>Choose a role</option>
        {['vendor_owner', 'vendor_staff', 'rider', 'support_agent', 'finance_admin', 'platform_admin'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
      </Select>
      <Select label="Action" name="op" defaultValue="grant">
        <option value="grant">Grant</option><option value="revoke">Revoke</option>
      </Select>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Apply'}</Button>
    </form>
  )
}
