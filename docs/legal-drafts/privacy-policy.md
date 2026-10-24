# Privacy Policy (draft)

> **DRAFT — NOT APPROVED FOR PUBLICATION — REQUIRES REVIEW BY A QUALIFIED NIGERIAN LEGAL PROFESSIONAL**
> Prepared by the engineering team from the behaviour of the application as of 2026-10-13 (HEAD `daee8a4` plus this stage). Square-bracket items are unverified facts or unmade decisions. Nothing here is legal advice, and nothing here has been approved by the owner, AFIT, or counsel. Do not publish.

Operator: [NOBS AGENT — LEGAL NAME, REGISTRATION AND ADDRESS TO BE VERIFIED; not yet registered]. Privacy contact: [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED].

## 1. Who we are and roles

The operator decides why and how personal data is processed and is expected to be the **data controller** [COUNSEL: confirm; also whether registration with the Nigeria Data Protection Commission as a data controller "of major importance" is required]. Service providers (hosting and database, payment processing, email delivery if enabled) act as processors. **AFIT is not stated to be a controller or processor and does not endorse the service unless it authorises this in writing.**

## 2. What we collect (matches `docs/privacy/data-inventory.md`)

| Data                                                                                                                                                                             | Source              | Why                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------ |
| Email, password (hashed, held by the authentication service), authenticator-app second factor, role, display name, **confirmation that you are 18 or over and when you gave it** | You                 | Account, security, eligibility       |
| Orders, items, totals, delivery point label, status history                                                                                                                      | You and the vendor  | Fulfilment, receipts, accounting     |
| Payment references and amounts (no card data)                                                                                                                                    | Payment provider    | Verify payment, reconcile, refunds   |
| Refund, return and support-case text, statements and evidence                                                                                                                    | You, vendors, staff | Resolve complaints                   |
| Pickup-code hashes and attempt counters                                                                                                                                          | System              | Prevent misuse of codes              |
| **Delivery signature image and recipient name**                                                                                                                                  | You                 | Proof of delivery                    |
| **Rider location** (live and recent GPS while on an active delivery)                                                                                                             | Rider's device      | Delivery tracking and arrival checks |
| Rider and vendor application details (name, contact, answers; no ID or vehicle documents are collected today)                                                                    | Applicants          | Approval                             |
| Notifications and delivery status of optional notifications                                                                                                                      | System              | Keep you informed                    |
| Reviews and review reports                                                                                                                                                       | You                 | Reputation, moderation               |
| Audit and security logs; rate-limit keys (may contain an IP address or an email hash)                                                                                            | System              | Security, accountability             |

## 3. Purposes and legal bases

[COUNSEL: map each purpose to a lawful basis under the NDPA (contract performance, legal obligation, legitimate interests, consent for optional email notifications and any location processing). Not completed here because the NDPA lawful-basis provisions could not be read from a primary source.]

## 4. Who receives data

Vendors see the information needed to prepare an order (not your email unless the product requires it [ALIGN WITH CODE]). Riders see delivery details for their own assignments only. Staff see data only for their role, and sensitive access is logged. Providers: [HOSTING/DATABASE PROVIDER AND REGION TBC], [PAYMENT PROVIDER TBC], [EMAIL PROVIDER, ONLY IF ENABLED]. We do not sell personal data.

## 5. Transfers outside Nigeria

Providers may process data outside Nigeria. [COUNSEL: NDPA cross-border requirements; hosting region undecided.]

## 6. Retention

**No retention period has been approved.** For each category the decision (owner, counsel) is pending: accounts, orders, payments and refunds, support cases, signatures, rider location, audit logs. Today the only automatic deletion is rider location history, with a placeholder of **24 hours** that nobody has approved, and **it is not scheduled in any real environment** (the purge only runs if someone runs it). Financial, audit and dispute records are append-only by design. [FILL after decisions; do not publish an invented period.]

## 7. Your rights and how to use them

You may ask for access, correction, deletion (subject to records we must keep), objection and, where the law gives it, portability; and you may complain to the Nigeria Data Protection Commission. Send requests to [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED]. **Today there is no export or deletion tool; requests are handled by a manual procedure** (see the Account Closure and Data Requests draft). [COUNSEL: statutory response times.]

## 8. Rider location (summary)

See the Location Tracking and Delivery-Proof Notice. Location is collected only when a rider is on shift with an active delivery; customers can see tracking only for their own eligible order; staff access is limited and logged; it is not kept forever. [Retention pending.]

## 9. Delivery signature (summary)

Collected to show you received the order; bound to the order and the current assignment; **not** shown back through the app; access limited and logged; retention pending. If you cannot draw a signature contact support. **We disclose that the signature pad cannot yet be operated by keyboard; an accessible alternative is being considered.**

## 10. Security

Role-based access, mandatory second factor for privileged roles, row-level security, append-only audit trails, redacted logs. **No independent security audit has been carried out.** [Do not state compliance.]

## 11. Breaches

We will assess incidents and notify the Commission and affected people where the law requires; the incident-response plan is **not yet written** and the 72-hour figure reported for the Commission must be confirmed. [COUNSEL; OWNER.]

## 12. Children

The service is for adults (18+). If we learn an account holder is under 18 we may close the account. [COUNSEL.]

## 13. Changes and contact

[COUNSEL] Contact: [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED].
