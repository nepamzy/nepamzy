# Automatic vendor payouts

**Owner decision (2026-11-07):** a shop is paid automatically **24 hours after an order is completed**. The customer has that time to report a problem and get a refund. Nobody has to press anything.

## What happens

1. An order becomes `COMPLETED` (handover confirmed). In the same transaction the database writes the settlement line (sales, commission) and a **payout** row (`vendor_payouts`) due 24 hours later. The waiting time is the setting `payout_hold_hours` (platform administrators can change it, 1 to 720 hours; it is audited).
2. The customer's order page says: "your payment is protected for 24 hours; report a problem until <time>".
3. A scheduled job (`/api/jobs/run-all`, once a day at 06:00 UTC, or `/api/jobs/release-payouts` called by any scheduler) claims the payouts that are due:
   - a complaint (`support_cases` open or under review) or an open refund **holds** the payout; it is looked at again next run;
   - the amount is worked out in the database: sales - commission - refunded sales + commission returned;
   - the app creates a Paystack transfer recipient for the shop's verified bank account (once) and sends the transfer with a unique reference.
4. Paystack answers `success` (paid), `pending` (the webhook `transfer.success` / `transfer.failed` / `transfer.reversed` finishes it) or `failed` (tried again after 6 hours, up to 5 attempts; the owner gets an alert e-mail).
5. A run that stopped half way never sends a second transfer: the same reference is checked with Paystack first.

Only orders completed **after** the migration `20261108000001_vendor_payouts.sql` get a payout. Older (test) orders are untouched.

## Where to look

- Shop owner: Earnings page (status per order, next payment date).
- Administrators (platform, finance): **Payouts** page (counts, failures, "Try again").
- Job monitoring: `/admin/jobs` (job `release-payouts`).

## Needed before real money moves (owner)

- The application is **hard-wired to Paystack TEST keys** (`sk_test_...`); live keys are refused on purpose (`src/lib/env.ts`). Going live is a deliberate code change plus a live Paystack account.
- In Paystack (live): Transfers enabled; "Confirm transfers before sending" (OTP) **switched off** for API transfers; a balance big enough to cover payouts; the server's IP allow-listed if Paystack asks.
- Test mode asks for a one-time code on transfers; the app answers it with Paystack's test code `123456` automatically.
- A refund decided **after** a payout has been made is not taken back from the shop automatically (no recovery flow exists yet).
- Legal: counsel should confirm that holding customer money for 24 hours is allowed in this form (see the vendor agreement draft, section 7).

## Scheduler

Vercel runs `vercel.json` cron `0 6 * * *` (the only schedule allowed on a free plan). A payout that becomes due at 14:00 is paid by the next run after that, so the real wait is between 24 and 48 hours. To pay within the hour, either upgrade the plan and change the cron to hourly, or have any scheduler call `POST /api/jobs/release-payouts` with `Authorization: Bearer $JOBS_SECRET` every hour.
