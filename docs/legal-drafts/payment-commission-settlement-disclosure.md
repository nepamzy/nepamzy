# Payment, Commission and Settlement Disclosure (draft)

> **DRAFT — NOT APPROVED FOR PUBLICATION — REQUIRES REVIEW BY A QUALIFIED NIGERIAN LEGAL PROFESSIONAL**
> Prepared by the engineering team from the behaviour of the application as of 2026-10-13 (HEAD `daee8a4` plus this stage). Square-bracket items are unverified facts or unmade decisions. Nothing here is legal advice, and nothing here has been approved by the owner, AFIT, or counsel. Do not publish.

Support: [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED]. The commission model is decided (`docs/financial-model.md`); settlement and payouts are not. **Do not publish until counsel has reviewed it.**

1. **What you see at checkout:** the product subtotal, the delivery fee (separate) and the total. **There is no platform or service fee for customers.**
2. **How payment works:** through [PAYMENT PROVIDER TBC]; we verify every payment with the provider before confirming an order; we never store card details. The real provider has not been used in live mode; only a local fake has been exercised.
3. **Vendor commission:** 4.5% of the product value of a completed order (after product discounts), delivery excluded, reversed in proportion to refunds, rounded to the kobo (half up), shown to the vendor per order. 3% is allocated to AFIT Market and 1.5% is an internal budgeting allowance toward payment-provider charges (not an official tariff); AFIT Market pays the provider's actual charges.
4. **Delivery fee:** paid by the customer in the app; the rider's share and timing are **undefined**.
5. **Refunds:** limited to money received; see the Refund Policy.
6. **Settlement and payouts:** **not yet defined or enabled.** [COUNSEL/PAYSTACK: funds flow, whether the operator may hold funds, timing.]
7. **Taxes and receipts:** [TAX ADVISER].
