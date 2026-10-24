# Vendor, rider, customer and dispute models: gap analysis and proposals (Master Prompt 1, Parts 7 to 9)

Prepared 2026-10-13 against HEAD `daee8a4`. This is **analysis and proposals for owner and legal review**. Nothing here changes behaviour, and nothing is approved. Items marked "owner decision" are not decided.

## 1. Vendors

**What exists:** `vendor_applications` (business name, phone, category, description, pickup location text, `terms_accepted_at`, status pending/approved/rejected with a decision reason and decider); administrators approve; the terms checkbox wording is not approved; no identity, payout-account or food-safety data is collected; no suspension/appeal workflow beyond an administrator disabling a vendor.

**Proposed risk-based onboarding (owner and legal to approve; collect only what is needed):**

| Requirement                                     | Individual seller                                                               | Registered business                                                       | Collected today                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Identity check appropriate to type              | Reviewed by an administrator (what ID is acceptable is an owner/legal decision) | Business name; registration number only if the owner decides it is needed | No (manual)                                                                              |
| Verified contact details                        | Email (existing) and phone                                                      | Same                                                                      | Phone yes; not verified                                                                  |
| Payout-account verification                     | Required before any payout exists (settlement is locked)                        | Same                                                                      | No                                                                                       |
| Approved operating location                     | Yes (pickup location text exists)                                               | Same                                                                      | Yes (free text)                                                                          |
| Food-safety and hygiene declaration (food only) | Declaration plus whatever the authorities require `[LEGAL]`                     | Same                                                                      | No                                                                                       |
| Prohibited-product rules                        | Acceptance of a list (the list is an owner decision)                            | Same                                                                      | No                                                                                       |
| Commission disclosure and acceptance            | Show 5% of the eligible product subtotal, delivery excluded, before acceptance  | Same                                                                      | **No** (blocked by the commission decision, see `commission-and-settlement-analysis.md`) |
| Suspension and appeal                           | Notice with reasons, a way to respond, a reviewer other than the first decider  | Same                                                                      | No                                                                                       |

No vehicle requirement applies to vendors. The vendor agreement draft is in `docs/legal-drafts/` (DRAFT, not for publication).

## 2. Riders

**What exists:** `rider_applications` with an **optional free-text `vehicle_note` (max 200)**, so nothing requires a car or motorcycle; administrator approval; terms acknowledgement enforced by the database (placeholder terms are refused); shifts, offers and **a hard limit of five active deliveries per rider, enforced in the database** (slots 1 to 5 with a unique index and a rider row lock; concurrency-tested in `tests/db/rider-concurrency.test.ts`); one active assignment per order; stale or replaced assignments cannot complete a delivery; GPS only for the rider's active work, with retention purge; incident reporting (rider issues). No identity or transport documents are modelled (K46), and no approved zones exist (K36).

**Proposed verification model (conditional on transport; owner and legal to approve):**

- Everyone: identity check by an administrator, minimum age 18 (self-declaration exists at sign-up as of this stage; documentary age verification is an owner/legal decision), contact verification, accepted terms, GPS permission acknowledgement.
- Public-transport or on-foot riders: **no vehicle documents**.
- Motorcycle or car riders: licence and any legally required vehicle documents **only for the vehicle they say they use**, as the law requires `[LEGAL]`.
- Eligibility to enter campus zones comes from AFIT's rules (not decided): registration never grants zone access automatically.
- Safety expectations, cancellation rules, handover and false-delivery prevention are enforced by the existing delivery-proof design (unchanged), the assignment constraints above and incident reporting.
- Suspension and appeal as for vendors.

The rider agreement draft is in `docs/legal-drafts/` (DRAFT). It does not classify riders as employees, contractors or agents.

## 3. Customers

- **Minimum age 18 (implemented this stage as a self-declaration):** the sign-up form requires the checkbox "I confirm that I am 18 years old or older."; the server action refuses without it; the declaration time is recorded in `profiles.adult_declared_at`; no date of birth or document is collected. **Limits, stated plainly:** it is a self-declaration, not verification; the public sign-up API can still create an account without the flag (the database records the flag when present but does not reject its absence, so seeded staff and test accounts keep working); a stricter rule is an owner decision.
- **Non-AFIT registration:** any adult may register. Registration grants only the customer role; no campus zone, staff or vendor/rider capability is granted automatically (those need separate applications and approvals). No student/staff/military status is collected.
- **Conduct rules** (accurate delivery information, respectful behaviour, genuine complaints, no fraud, compliance with approved campus access rules) are in the Customer Terms draft.

## 4. Disputes and accountability

**What exists (Batch 5, tested):** support cases (`support_cases`, one open case per order and type), statements from both parties (`case_statements`), append-only `case_events` audit, refund requests with approval limits, partial and full refunds capped at money received, return requests, separation between requester and approver for refunds, duplicate-resolution protection (state checks under locks), in-app notifications of status changes.

**Gaps found (no code changed; proposals):**

| Gap                                                                                  | Proposal                                                                                                                                        | Needs                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| No appeal path after a case is decided                                               | A single appeal per decision, reviewed by a different staff member than the original decider, recorded as a new case event                      | Owner decision and design |
| No customer-misconduct workflow (repeated no-shows, abuse, fraudulent refund claims) | Staff-recorded findings with evidence and a reasoned decision before any account restriction; never automatic from a vendor or rider accusation | Owner decision (policy)   |
| Evidence collection is limited to written statements                                 | Allow optional evidence notes; any file upload needs a storage and privacy design                                                               | Owner decision            |
| Adverse-party response windows are not defined                                       | Define a response period before decision                                                                                                        | Owner decision            |

Customer rights under Nigerian law must be preserved (see the legal drafts' research and review checklist); the dispute policy draft does not attempt to remove them.
