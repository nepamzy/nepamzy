import { ButtonLink } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">We can’t find that page</h1>
      <p className="mt-2 text-muted">The link may be old or mistyped.</p>
      <div className="mt-6 flex justify-center"><ButtonLink href="/">Go to home</ButtonLink></div>
    </main>
  )
}
