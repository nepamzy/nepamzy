# External approvals still required (none obtained)

| #   | Approval / confirmation                                                        | From                    | Blocks                    |
| --- | ------------------------------------------------------------------------------ | ----------------------- | ------------------------- |
| 1   | Written permission for a campus marketplace pilot; authorised signatory        | AFIT                    | Any launch                |
| 2   | Approved delivery points/zones, hours, prohibited areas, map detail            | AFIT                    | Batch 4 real data, launch |
| 3   | Use of AFIT name/logo                                                          | AFIT                    | Public branding           |
| 4   | Marketplace settlement/delayed-release model, refunds with splits, chargebacks | Paystack                | Live payments, settlement |
| 5   | Funds-flow, terms, signature evidence, NDPA, retention periods                 | Nigerian legal counsel  | Launch                    |
| 6   | Return policy per category (food/perishables)                                  | Owner + counsel         | Batch 5 policy            |
| 7   | Real-device Android location tests                                             | Owner/devices           | Batch 4                   |
| 8   | Repository rename to `afit-market`                                             | Owner (GitHub settings) | Session repo scope        |

## Added in Batch 4

| #   | Approval / confirmation                                                                                                                                 | From            | Blocks                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------- |
| 9   | Approved delivery points, coordinates, geofence sizes and prohibited zones (none held; all current coordinates are synthetic)                           | AFIT            | Real arrival detection, launch      |
| 10  | Whether live rider location may be shown to customers at all, and map detail allowed                                                                    | AFIT            | Live map                            |
| 11  | Rider terms, conduct rules and privacy notice (current text is a development placeholder)                                                               | AFIT + counsel  | Onboarding any real rider           |
| 12  | Choice and purchase of a routing/map provider (cost + privacy review)                                                                                   | Owner           | Real route distance/ETA             |
| 13  | Real-device Android tests of rider location (`docs/testing/android-background-location-test.md`)                                                        | Owner/devices   | Any claim about background tracking |
| 14  | Decision on typed acknowledgement as a signature alternative; signature storage location                                                                | Owner + counsel | Accessible handover                 |
| 15  | Rider eligibility, ID/badge, vehicle and insurance rules, and what happens when a rider goes offline mid-route                                          | AFIT + owner    | Rider onboarding policy             |
| 16  | AFIT-approved rider terms (also unblocks K48: placeholder terms must never authorise real rider work)                                                   | AFIT + owner    | Any real rider operation            |
| 17  | Refund and return policy: partial refunds, service-fee share, who may approve and up to what amount, food/hygiene return rules per category, restocking | Owner + counsel | Any real refund or return           |
| 18  | Written procedure for a recipient who cannot draw a signature, and for a recipient who is not the account holder (K27/K47/K52)                          | Owner + AFIT    | Real deliveries                     |
| 19  | Independent verification of real Paystack refund behaviour with owner-controlled test credentials (K19/K29/K30) before any real execution               | Owner           | Refund execution                    |

## Added in Batch 6

| #   | Approval / confirmation                                                                           | From            | Blocks                                                          |
| --- | ------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| 20  | Who schedules the three jobs, on which infrastructure, and who is alerted when one fails          | Owner           | Order expiry, location purge, notification delivery in practice |
| 21  | Any real notification channel (email/SMS/push): provider, cost, privacy review, wording           | Owner + counsel | Real messages                                                   |
| 22  | Retention periods and data-subject request handling (NDPA/NDPC)                                   | Owner + counsel | Launch; purge jobs                                              |
| 23  | Review policy: eligibility, edit/delete rules, community rules text, shop replies                 | Owner           | Public reviews to real users                                    |
| 24  | Backup storage, frequency, encryption, recovery targets; restore rehearsal on the chosen platform | Owner           | Any real data                                                   |
| 25  | Incident response plan and support staffing/escalation                                            | Owner + AFIT    | Pilot                                                           |
| 26  | Independent security review / penetration test                                                    | Owner           | Any claim of security assurance                                 |

## Added in the post-Batch 6 remediation

| #   | Approval / confirmation                                                                                            | From                   | Blocks                                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------- |
| 27  | Review policy decisions (`docs/review-policy-register.md`)                                                         | Owner                  | Public reviews to real users                  |
| 28  | Retention periods per data category (`docs/privacy/data-inventory.md`, retention register)                         | Owner + counsel        | Launch; any purge job                         |
| 29  | An accessible, trustworthy alternative to the drawn signature; screen-reader and device accessibility review       | Owner + AFIT + counsel | Real deliveries to recipients who cannot draw |
| 30  | Job scheduler, cadence, alert route and on-call owner (`docs/operations/jobs.md`)                                  | Owner                  | Any unattended operation                      |
| 31  | Settings change-control standard (who may change fees/limits, reason quality, review)                              | Owner                  | Real pricing                                  |
| 32  | Approval workflow for rider terms (today only direct database access can approve; the settings function is locked) | Owner + AFIT           | Any real rider onboarding                     |

The complete list of decisions, with current defaults and pilot-blocking status, is in `docs/owner-decisions.md`.
