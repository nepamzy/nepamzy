# Decisions and Open Gates

## Confirmed product decisions
1. Product: AFIT Market — a campus marketplace for approved AFIT community users.
2. Users: buyers, vendors, delivery riders and administrators, with role-specific access.
3. Fulfillment: customer chooses pickup or delivery.
4. Delivery: live map, route distance/ETA and automatic location updates.
5. Database: Supabase Postgres.
6. Rider location: no tracking until rider explicitly chooses Go Active; off-duty location is not saved.
7. 2FA: included in V1.
8. Signature: mandatory for every successful handover.
9. QR/app code: optional verification methods, avoiding paid SMS dependency.
10. QR binding: delivery QR/token is created/bound to the order and the rider who accepted/was assigned it; one-time and expiring.
11. Rider cannot press a simple “delivered” button to complete an order.
12. Up to five accepted active deliveries per rider, enforced atomically.
13. Refund: full refund or item-level partial refund, with applicable fee adjustments as policy allows.
14. Disputes: evidence-based review; no automatic assumption that one party is truthful.
15. Pickup: one easy vendor handover screen; scan QR or enter code to resolve the order, then mandatory recipient signature.
16. Build phases: Phase 0 discovery plus 12 implementation phases; stop after each phase for review.
17. Founder needs a separate physical/non-coding action checklist for AFIT, vendors, riders, payment, legal/privacy and launch.

## Best-fit technical recommendation (Claude must verify before committing)
- Next.js App Router + TypeScript + Tailwind + PWA
- Supabase Auth, Postgres, RLS, Realtime and private Storage as appropriate
- Server-side domain logic for order/payment/refund/proof transitions
- Paystack initial provider, sandbox first
- Map provider selected after testing actual coverage, pricing and AFIT permission
- TOTP authenticator app for cost-conscious 2FA
- In-app notifications first; SMS optional later

## Open gates — do not silently assume
1. AFIT written permission and who is authorized to grant it.
2. Allowed delivery points, prohibited zones, operating hours and map detail.
3. Whether AFIT name/logo can be used commercially.
4. Paystack's approved marketplace settlement/payout model and whether delayed release is technically/contractually supported.
5. Legal/compliance design for funds flow and vendor payouts.
6. Exact data retention periods and legal requirements for signature/GPS evidence.
7. Whether the selected PWA can reliably collect rider location under the required screen/background conditions on target Android devices. If not, evaluate a dedicated rider app only after demonstrating the limitation.
8. Which buyer roles must use mandatory 2FA at all times versus for sensitive actions; admins and privileged vendor/rider operations must be protected.
9. Whether returns are required by category, especially food/perishable goods.
10. Pilot vendor count, rider count, order caps, commissions and delivery fee formula.

## Payment settlement warning
Paystack's split payments distribute settlement among the platform and subaccounts. That is not automatically escrow and may not support “wait until delivery signature, then release” as assumed. Verify with Paystack and legal counsel before building a live promise around delayed settlement.
