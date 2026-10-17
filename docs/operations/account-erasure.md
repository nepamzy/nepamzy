# Account erasure and financial records

Handled by a platform administrator on `/admin/data-requests` (deletion and closure requests), using the database function `admin_erase_account`.

**What happens (all or nothing):** the sign-in record is kept as an anonymous tombstone (`erased-<id>@erased.invalid`, no password, banned, no sessions/factors/identities, roles revoked); profile name, rider name and phone, rider bank details, location data, cart, notification preferences, notification text and request details are removed or blanked; bank details inside payment snapshots are replaced by "(erased)"; receipts keep their number and token (public check keeps working) but show "Former customer" / "Former rider". An `account_erasures` record (append-only) stores who, when and why.

**What is kept and why:** orders, payments, ledger, refunds, settlement lines and the audit trail (financial integrity, pseudonymous id only); dispute and report records and append-only event notes (evidence; cannot be edited by design); published reviews (shown without identity); the erasure record itself.

**Refused while unfinished business exists** (nothing changes; the blockers are listed): open orders, refunds, reports or returns; unresolved delivery-fee payments; active deliveries or open rider issues; an active shop (suspend it first); staff roles (revoke first). Repeating the call is harmless.

**Not decided here (needs qualified Nigerian legal and tax advice):** how long financial records and the retained free-text notes must be kept and when they may be purged; whether erased accounts may be re-registered with the same email; response deadlines for requests. No retention period has been invented.
