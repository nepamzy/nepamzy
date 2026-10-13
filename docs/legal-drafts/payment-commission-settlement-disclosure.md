# Payment, Commission and Settlement Disclosure (draft)

> **DRAFT — NOT APPROVED FOR PUBLICATION — REQUIRES REVIEW BY A QUALIFIED NIGERIAN LEGAL PROFESSIONAL**
> Prepared by the engineering team from the behaviour of the application as of 2026-10-13 (HEAD `daee8a4` plus this stage). Square-bracket items are unverified facts or unmade decisions. Nothing here is legal advice, and nothing here has been approved by the owner, AFIT, or counsel. Do not publish.

Support: [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED]. **Do not publish until the commission decision is made** (`docs/reports/commission-and-settlement-analysis.md`).

1. **What you see at checkout:** product subtotal, delivery fee (separate), and any other charge, then the total. [OWNER: the existing build adds a 5% customer service fee; the intended policy is a 5% **vendor** commission. Final wording depends on that decision.]
2. **How payment works:** through [PAYMENT PROVIDER TBC]; we verify every payment with the provider before confirming an order; we never store card details. The real provider has not been used in live mode; only a local fake has been exercised.
3. **Vendor commission (intended):** 5% of the eligible product subtotal of a completed order; delivery charges excluded; reversed in proportion to refunds; rounded to the nearest kobo (half up); shown to the vendor per order before and after deductions.
4. **Delivery fee:** paid by the customer in the app; the rider's share and timing are **undefined**.
5. **Refunds:** limited to money received; see the Refund Policy.
6. **Settlement and payouts:** **not yet defined or enabled.** [COUNSEL/PAYSTACK: funds flow, whether the operator may hold funds, timing.]
7. **Taxes and receipts:** [TAX ADVISER].
