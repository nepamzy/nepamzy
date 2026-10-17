# ADR 0003: delivery proof, refunds, returns and disputes (Batch 5)

Status: accepted for the local build; real provider execution, return logistics and several policies are open owner decisions.

## Context

Batch 4 left an order at ARRIVAL_DETECTED. Phase 9 must finish a delivery without letting anyone but the recipient do it; Phase 10 must let money questions be asked, decided and (later) executed without ever moving real money in this release.

## Decisions

1. **The recipient completes the delivery, not the rider.** After the server detects arrival the customer starts a confirmation (`delivery_proof_begin`), sees the order summary and signs; `complete_delivery` validates and writes everything in one transaction. The assignment gets a terminal status `completed`, which frees the slot because the active-status indexes list statuses explicitly.
2. **A proof-session token binds the signature to the current assignment.** It is generated on the server, only its hash is stored, it expires, is single use and is not a code anyone else holds. It is not a QR code. A visible/QR code for riders is a future enhancement (K55).
3. **Evidence reuses `handover_evidence`** (one immutable table, `evidence_kind` pickup|delivery). The row's primary key is the final backstop against duplicate completion.
4. **Refund = request, approval, execution, outcome** with a state machine enforced by trigger. The cap is enforced by a function lock, a balance check and a trigger that locks the order and re-checks the ledger. Execution exists only as a FAKE adapter that fails closed outside `local`.
5. **Cases are decided by people.** `case_decide` is the only writer of a decision; a refund decision only creates a refund request that finance must approve (the deciding staff member cannot approve it).
6. **Returns are separate from refunds** and never restock. Customer-brings is the only method.
7. **Supervised exceptions** (`ops_handle_delivery_exception`) release the parcel and open a report; they cannot deliver.

## Consequences / open decisions

Policy values are placeholders (K50). Real Paystack refund behaviour is unverified (K19/K29/K30). Return logistics (K49), evidence uploads (K51), notifications (K54) are not built.
