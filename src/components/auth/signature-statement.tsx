/** The wording shown wherever someone is asked to choose their signature. */
export function SignatureStatement() {
  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-line bg-surface p-3 text-sm">
      <p className="font-semibold text-navy-900">Your AFIT Market signature</p>
      <p>
        This is the signature you will use on AFIT Market to <strong>receive deliveries</strong>,{' '}
        <strong>hand orders over</strong> and confirm things in the app. We save it safely and
        compare your later signatures with it, so please sign the way you normally do.
      </p>
      <p className="text-muted">
        Signatures never look exactly the same twice, so a close match is enough. You will not be
        asked to redo it each time.
      </p>
    </div>
  )
}
