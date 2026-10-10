import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { loadPrincipal } from '@/server/modules/identity-and-access/guard'

export async function PublicHeader() {
  const who = await loadPrincipal()
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-xl font-extrabold text-brand-800">
          AFIT Market
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <Link
            href="/vendors"
            className="touch-target inline-flex items-center px-3 font-semibold hover:underline"
          >
            Browse
          </Link>
          {who.authenticated ? (
            <ButtonLink href="/account" variant="secondary">
              My account
            </ButtonLink>
          ) : (
            <>
              <Link
                href="/login"
                className="touch-target inline-flex items-center px-3 font-semibold hover:underline"
              >
                Sign in
              </Link>
              <ButtonLink href="/signup">Create account</ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
