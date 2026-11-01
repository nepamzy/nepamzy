import { redirect } from 'next/navigation'

/** The Administrator/Customer switch was removed; staff always use the administrator view. */
export default function ModePage() {
  redirect('/')
}
