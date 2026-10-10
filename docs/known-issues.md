# Known issues and risks (Phase 0 stage)

| ID | Severity | Issue | Next step |
|---|---|---|---|
| K1 | High | Local Docker daemon not running in the dev environment; Supabase local stack unverified | Batch 1 prompt Part 2 and 1.7: try to start; else BLOCKED, ask owner |
| K2 | High | PWA background GPS reliability unknown | Real Android tests in Batch 4; owner decides if native needed |
| K3 | High | MFA recovery not verified; experimental Supabase recovery-codes feature not assumed safe; no custom workaround allowed | Batch 1 spike; stop for owner decision if no secure design |
| K9 | Med | Session revocation / `aal` refresh behavior after factor changes unverified | Batch 1 local-stack tests |
| K4 | High | Vendor settlement/escrow arrangement unconfirmed | Paystack + Nigerian counsel; settlement disabled |
| K5 | Med | Package versions, Paystack refund/webhook details unverified | Verify in Batch 1/3 |
| K6 | Med | Repository rename to `afit-market` is an owner action; session repo scope may need update | Owner renames; confirm |
| K7 | Med | Retention periods (GPS, signatures) are placeholders pending legal advice | Legal |
| K8 | Info | CodeRabbit skips draft PRs (no review run on PR #1) | None |
