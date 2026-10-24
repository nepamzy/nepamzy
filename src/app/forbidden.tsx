import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'

export default function Forbidden() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">You don’t have access to this page</h1>
      <p className="mt-2 text-muted">
        Your account does not have the permission needed here. If you think this is a mistake,
        contact support.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <ButtonLink href="/">Go to home</ButtonLink>
        <Link
          href="/account"
          className="touch-target inline-flex items-center px-3 font-semibold underline"
        >
          My account
        </Link>
      </div>
    </main>
  )
}
