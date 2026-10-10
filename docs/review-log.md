# Review log

## Review 1 — Phase 0 report, Batch 1 prompt, decisions register
Decision: **APPROVED IN PRINCIPLE WITH REQUIRED CORRECTIONS.** Source: owner-supplied independent review.

| # | Finding | Valid? | Action | Where |
|---|---|---|---|---|
| 1 | MFA policy: public browse without account; registered customers TOTP before ordering/protected features; staff/vendor/rider MFA before privileged features; enforce server + DB; verify Supabase docs | Yes (replaces my "optional for customers" recommendation) | Policy adopted; docs verified (aal claim, restrictive RLS template, unenroll needs aal2) | Report §G, §S; Batch 1 §5 |
| 2 | Recovery: verify supported flows before custom codes; no weaker system; rate-limited, audited; no single-admin takeover | Yes | Docs: no standard TOTP recovery codes; backup TOTP factor recommended; experimental recovery-codes factor exists (unverified). Custom hashed-code table **withdrawn**. Verification spike + decision gate added | Report §S; Batch 1 §4 |
| 3 | SECURITY DEFINER hardening; keep orchestration in app | Yes | Checklist and test requirements added | Batch 1 §6 |
| 4 | Rider PWA: no background-tracking claims without device evidence; stop and report, don't start native | Yes (tightens my wording) | Stated as rule; native app = owner decision | Report §O; Batch 1 §7 |
| 5 | Handover proof rules | Already designed; restated as acceptance rules | Batch 1 §7 | |
| 6 | Mock/test payments; settlement disabled; no "escrow"; Docker blocker → stop | Yes | Docker daemon found not running; blocker gate added | Report §S; Batch 1 §4.1 |
| 7 | README and docs | Yes | README, ADR, checklist, known-issues, security docs created | repo root, `docs/` |

Verification notes (Supabase docs, 2026-10-10): `aal` claim in JWT, restrictive RLS policy pattern, unenroll requires aal2, verification logs out other sessions, no recovery codes (backup TOTP recommended), experimental `recoveryCodes` API exists. **Not yet empirically verified** on a local stack (no stack available yet).
