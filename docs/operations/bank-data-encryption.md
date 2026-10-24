# Rider bank-number encryption: operation, rotation and recovery

**What is protected.** Rider bank account numbers (`rider_bank_accounts.account_cipher`, and the per-payment snapshot `delivery_fee_payments.account_cipher`). The bank name and account name are stored in clear (needed for display and support). Only the last four digits are stored in clear, for masked display.

**How.** The Next.js server encrypts the 10-digit number with AES-256-GCM (random 96-bit IV, authenticated, with fixed associated data) before it reaches the database; the database stores an opaque `v1.<keyId>.<iv>.<ciphertext+tag>` string and cannot decrypt anything. Decryption happens only on the server, only for the customer who must pay that order (the pay screen) and never for staff or riders (they see `******1234`). Implementation: `src/server/security/field-crypto.ts` (tests in the same folder and `tests/unit/bank-crypto-interop.test.ts`).

**Keys.** Server environment only (`.env.example` shows placeholders):
`BANK_DATA_KEYS="k1:<base64 of 32 random bytes>[,k2:<...>]"` lists every key that may still be needed to decrypt; `BANK_DATA_KEY_ID="k1"` names the key for new encryption. Generate with `openssl rand -base64 32`. Never commit, never prefix with `NEXT_PUBLIC_`, never store next to the database backup. `pnpm check:secrets` scans tracked files and the browser bundle for the configured key values. Without a valid current key the app **fails closed**: saving bank details is refused with a generic message and logs only an error code.

**Existing plaintext rows.** Rows saved before this feature keep working (the plain column stays until encrypted). Run once per environment, after setting the keys:
`node --env-file=.env.local scripts/encrypt-bank-details.mjs --dry-run` then without `--dry-run`. It prints counts only, is safe to repeat, and clears a row's plaintext only in the same update that stores its cipher. Platform administrators can see how many plaintext rows remain with the database function `admin_bank_encryption_status()` (zero is the target before any real use).

**Rotation.** (1) Add the new key to `BANK_DATA_KEYS`, keep the old one. (2) Set `BANK_DATA_KEY_ID` to the new id and restart. (3) Run `scripts/encrypt-bank-details.mjs --rotate`. (4) Confirm it reports nothing left on the old key, then remove the old key. Rotate immediately if a key is suspected to be exposed.

**Recovery and loss.** If every copy of a key is lost, the numbers encrypted with it are **unrecoverable by design**; riders must re-enter their details (customers cannot then be shown the account for already-opened payments; an administrator would have to resolve those by hand). Keep the keys in the hosting provider's secret manager with a sealed offline copy held by the owner. Back up the database and the keys separately. Restore drills must include proving a restored cipher can be decrypted with the restored key.

**Not covered.** This is encryption of one field at rest; it does not protect against someone who controls the running server (it holds the keys). It is not an independent security audit, and no key-management service (KMS) is used yet.
