'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { gate } from '@/server/modules/shared/action-helpers'

/** Finance and platform administrators can ask for another try at a payout that failed or is on hold. The next scheduled run does it. */
export async function retryPayoutAction(fd: FormData): Promise<void> {
  const g = await gate({ roles: ['platform_admin', 'finance_admin'], aal: 'aal2' })
  if ('state' in g) return
  const id = String(fd.get('payoutId') ?? '')
  if (!z.uuid().safeParse(id).success) return
  const sb = await createSupabaseServerClient()
  await sb.rpc('admin_payout_retry', { p_id: id })
  revalidatePath('/admin/payouts')
}
