import { ButtonLink } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16 text-center">
      <Logo className="mb-8" />
      <p className="text-5xl font-extrabold text-navy-900">404</p>
      <h1 className="mt-2 text-2xl font-bold">We can’t find that page</h1>
      <p className="mt-2 text-muted">The link may be old or mistyped.</p>
      <div className="mt-6 flex justify-center gap-3">
        <ButtonLink href="/" variant="gold">
          Go to home
        </ButtonLink>
        <ButtonLink href="/vendors" variant="secondary">
          Browse shops
        </ButtonLink>
      </div>
    </main>
  )
}
