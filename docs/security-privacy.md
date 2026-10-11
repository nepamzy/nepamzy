# Security and privacy notes

Status after Batch 1. Everything described as **Tested** has automated evidence listed in `docs/testing.md`; **Unverified** items are called out.

## 1. MFA policy (owner decision) — Implemented and Tested

- Public visitors browse public products without registering.
- Registered customers must complete TOTP MFA **before placing orders or using protected account features** (`/orders`, `/account`; in the database the stub order-placement rule and profile edits require aal2).
- Vendors, riders, support, finance and platform administrators must be at aal2 before ANY protected operational feature, in the app and in the database.
- Enforcement layers (never UI-only): (1) `requireAuth`/`enforceRoutePolicy` in every protected layout and server action; (2) RESTRICTIVE RLS on every table for privileged roles; (3) SECURITY DEFINER functions re-check `aal2` and role.
- Supabase behavior was verified on the local stack (`docs/review-log.md`) and is pinned by tests (`tests/e2e/mfa-api-behavior.spec.ts`).

## 2. Authentication design

- Server-side only: the browser never talks to Supabase; sessions are HttpOnly, SameSite=Lax cookies (Secure in production). No `NEXT_PUBLIC_` variables.
- Email + password, confirmation by emailed link (`token_hash`, single use), generic sign-up/sign-in messages (no account enumeration), password policy ≥10 characters with lower/upper/digit.
- Rate limits (database-backed, fail closed): sign-in 10/15 min per account hash and 30/15 min per IP; sign-up 10/hour per IP, 3/hour per address; TOTP verify 6/5 min per user. Failures and limits are written to the audit trail with hashed identifiers only.
- Proxy sets a per-request nonce CSP (`strict-dynamic`), frame/object/base restrictions, and refreshes the session.

## 3. MFA recovery — DESIGN GATE (owner decision required)

Verified facts (local stack, GoTrue v2.197.0):

- No standard recovery codes. The experimental recovery-code factor is **not available** (server returns 422/400); it is not used and not assumed safe.
- A second TOTP factor ("backup authenticator") can be enrolled at aal2 and signs in on its own. **Implemented and Tested** (`/account/security`). It is offered to everyone; it is **not** forced on customers. Whether to _require_ it for privileged roles is **proposed to the owner**.
- Removing the last factor drops the account to password-only; admin-API factor deletion does not revoke other sessions.
- **Not implemented:** recovery after losing ALL factors. A secure design needs decisions only the owner/AFIT can make (how identity is verified out-of-band, who approves). Minimum requirements if built: two distinct aal2 administrators (neither the account holder), identity verification step, holder notification, cooling-off delay, session revocation, forced immediate re-enrolment, full audit, and no way for one administrator to act alone. Until then: lost all factors = account locked; support cannot bypass MFA (no code path exists). Privileged users cannot remove their last authenticator (Tested).

## 4. Known security limitations (accepted for Batch 1, tracked in `known-issues.md`)

| #   | Limitation                                                                    | Why it matters                                                                                                 | Plan                                                                                                                        |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| S1  | TOTP codes are re-usable inside their 30 s window (GoTrue accepts a replay)   | An observer of a just-used code could reuse it for ≤30 s                                                       | Accept; rate-limited; revisit with Supabase                                                                                 |
| S2  | First factor can be enrolled at aal1                                          | Someone holding only a victim's password, on an account with no factor yet, could enrol their own factor first | Privileged accounts are pushed to enrol at first sign-in; consider forcing enrolment at sign-up; admin onboarding procedure |
| S3  | Account-scoped login limit allows a deliberate 15-minute lockout of a victim  | Nuisance DoS                                                                                                   | Accept for pilot; add CAPTCHA/progressive delays later                                                                      |
| S4  | IP rate-limit key uses `X-Forwarded-For`, trusted only behind a trusted proxy | Spoofable without a proxy                                                                                      | Document hosting requirement; account-scoped limits remain                                                                  |
| S5  | CSP uses `style-src 'unsafe-inline'`                                          | Weaker style injection protection                                                                              | Move to nonce styles when Tailwind/Next allow                                                                               |
| S6  | Sign-out ends the current session only                                        | Other devices stay signed in                                                                                   | "Sign out everywhere" in a later batch                                                                                      |
| S7  | Email-link scanners may consume a confirmation link                           | User sees "invalid link" but the address is already confirmed                                                  | Acceptable; sign-in still works                                                                                             |
| S8  | Next `forbidden()` is experimental                                            | API may change                                                                                                 | Covered by e2e 403 tests                                                                                                    |

## 5. Database

SECURITY DEFINER functions: fixed `search_path`, EXECUTE revoked from PUBLIC/anon, identity + authorization inside, allowed/denied tests, parallel-connection harness (stub). Catalog tests fail if any function loses `search_path`, becomes executable by PUBLIC/anon, or any table loses RLS or its restrictive policy. A mutation check (weakening three protections) made four tests fail, as intended.

## 5a. Payments and handover (Batch 3)

- Webhook: HMAC-SHA512 over the **raw** body with the test secret, constant-time compare, 64 KB cap; invalid signature = 401 and nothing is read further. Unknown events get 200 and are ignored; processing errors get 500 so the provider retries.
- The browser return URL proves nothing: the server asks Paystack to verify and the database applies the answer idempotently. Amount and currency are compared with the order row; a mismatch never pays the order.
- Only `sk_test_` keys are accepted (a live key disables payment). A non-default provider URL is honoured only when `APP_ENV=local`.
- Stored webhook payloads are whitelisted (no email, card or customer data).
- Pickup code: stored as a hash, shown only to the ordering customer at aal2, single use, 48 h expiry, locks after 5 wrong tries; wrong tries are counted (returned, not raised, so the counter commits) and audited. Signature must be a PNG of plausible size; recipient name required.
- Receipts are served by a route that checks the session itself (route handlers sit outside layouts) and relies on RLS for which order is visible.
- Limitation: a vendor who knows the customer is present can ask for the code; the code proves possession, the signature proves acknowledgement, neither proves identity. Documented for counsel.

## 5b. Pickup secret, riders and location (Batch 4)

- **Pickup-code secret.** `PICKUP_CODE_SECRET` (server-only env var, 32+ random characters, never `NEXT_PUBLIC_`, never in the database or logs) derives each customer code as HMAC(order id, nonce). The database stores the nonce and only the SHA-256 hash of the code. A database dump alone therefore cannot reproduce codes. A missing, short or placeholder secret throws and no code is shown (fail closed; no fallback). Residual: the app server and its environment are trusted; secret rotation is not designed (K44).
- **Rider access.** Rider functions require the `rider` role, an `approved` profile, aal2, acknowledgement of the current terms and (to accept work) an active shift. Suspension revokes the role, ends the shift, releases un-collected work and flags in-progress parcels for staff.
- **Capacity and exclusivity.** Enforced in the database with layered controls (locks + unique indexes + conditional update); tests remove layers to show which is the backstop.
- **Handover token.** Random, hashed, assignment-bound, expiring, locked after 5 wrong tries, invalidated on release. It is separate from the customer pickup code.
- **Location is sensitive.** Collected only on an active shift with an accepted delivery. Fixes are validated for range, accuracy, freshness and frequency. Current position and limited history live in tables with no API-role access; reads go through functions that check identity (own order, in transit, rider on shift) or, for staff, record an operational purpose in the audit trail. Retention is configurable and purged by a protected job. A missing location never causes a refund, penalty or adverse state change.
- **Arrival is inferred by the server** from a fresh, accurate fix inside the geofence while the order is `EN_ROUTE`. There is no client-claimed arrival and no manual arrival button. Arrival never completes an order.
- **Browser permission.** `Permissions-Policy` allows geolocation only under `/rider`; elsewhere it stays blocked. Rider location is sent through a server action, never directly to Supabase.
- **Synthetic data.** Delivery-point coordinates are fictional (open sea); the map is a labelled sample. No real AFIT coordinates are held.
- Limitations: background tracking unverified (K34); no real routing provider (K35); staff location access relies on the purpose being truthful (it is audited, not verified).

## 6. Location, proof, payments (rules carried forward)

Rider location only after Go Active; stale/inaccurate fixes ignored; GPS never completes an order; no claim of background tracking without real Android evidence (if the PWA cannot do it: stop and report evidence; no native app without owner approval). Mandatory signature; single-use, expiring, assignment-bound tokens; reassignment invalidates tokens; auditable. Payments mocked/test-mode only; settlement disabled (code-locked); never called escrow.

## 7. Privacy

Synthetic data only; no real AFIT locations; no analytics; logs redact secrets; emails never stored in audit details (hash prefix only). Retention periods and data-subject workflows are placeholders pending legal advice.

## 5c. Delivery proof, refunds and reports (Batch 5)

- **No rider completion.** No function a rider can use sets DELIVERED/COMPLETED. The recipient (the account holder) completes the delivery in their own app with a drawn signature after the server detected arrival. A rider who is also the customer cannot confirm their own delivery. A test lists every function that can reach the proof/completed states; adding one needs a conscious change to that list.
- **Proof token.** 6 random bytes (12 hex characters), only a SHA-256 hash stored, bound to the order and the current assignment, 20 minutes (placeholder), one live per assignment, locked after 5 wrong tries, invalidated when the screen is restarted or the assignment is released. It is a different secret from the customer pickup code and from the rider handover token; substituting either fails.
- **Typed acknowledgement** is refused for deliveries even if the owner flag is switched on (decision K27 outstanding). The signature is never labelled otherwise: receipts and audit show the real capture method.
- **Evidence privacy.** Signature rows are readable by the customer (and by the shop for pickups only). Support sees metadata through `staff_case_bundle` (no image, no coordinates) and the image only through `staff_get_delivery_proof` (purpose required, audited). Cases never edit proof.
- **Refunds.** Request, approval and execution are separate roles/steps; nobody decides or runs their own request; the provider is FAKE and labelled everywhere (customer and staff screens, `provider_mode`); real modes fail closed. An unknown outcome keeps the money reserved and opens a reconciliation flag; a contradictory late report changes nothing and opens a flag.
- **No automatic guilt.** Only `case_decide` can set a decision (tested). GPS or a missing location update never decides a case; the bundle contains arrival time and geofence radius, never raw coordinates.
- **Parties.** Each side of a case sees its own statements plus support's public ones; the customer cannot read vendor/rider statements through the table either.
- Limitations: see K49-K55 in `known-issues.md`.

