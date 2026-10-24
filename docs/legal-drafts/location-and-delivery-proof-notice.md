# Location Tracking and Delivery-Proof Notice (draft)

> **DRAFT — NOT APPROVED FOR PUBLICATION — REQUIRES REVIEW BY A QUALIFIED NIGERIAN LEGAL PROFESSIONAL**
> Prepared by the engineering team from the behaviour of the application as of 2026-10-13 (HEAD `daee8a4` plus this stage). Square-bracket items are unverified facts or unmade decisions. Nothing here is legal advice, and nothing here has been approved by the owner, AFIT, or counsel. Do not publish.

Contact: [AFIT MARKET SUPPORT EMAIL — TO BE PROVIDED].

## Location (riders and customers)

- **When:** a rider's location is collected only while the rider is on shift with an active delivery. A rider who is off shift or has no active delivery is not tracked.
- **Who sees it:** the customer of that order can see tracking for their own eligible order. Other customers, vendors and the public cannot. Staff can access it only for a stated purpose; access is logged. [ALIGN WITH CODE and owner policy for staff access.]
- **Quality limits:** the app rejects very old or inaccurate fixes; a missing location never changes an order's status by itself; arrival inference uses an approved delivery point's coordinates. **All coordinates in the system today are synthetic; no real campus coordinates exist.**
- **Retention:** history is deleted after a placeholder period (**24 hours**) that has **not** been approved and is **not** scheduled automatically. [OWNER: final period; no indefinite retention.]
- **Limits:** background tracking on phones can be restricted by the operating system; behaviour on real Android devices is **unverified**.

## Delivery proof

- **Why:** to show the order reached the account holder.
- **How:** the customer opens the order in their own signed-in session; a one-time proof token (shown only there, hashed in the system, expiring after **[20 minutes]**) lets the customer draw a signature for the rider's current assignment. The token is tied to that order and assignment; it cannot be reused; the rider cannot see it.
- **Who can access the signature:** it is not returned through the app to anyone; access by authorised staff for a dispute is limited and logged. [OWNER: who, how long kept.]
- **If you cannot draw a signature:** contact support. Support may investigate or release the parcel under its exception rules, but the order is not recorded as delivered unless it was.
- **Accessibility disclosure:** the drawn signature is **not** operable by keyboard today. The owner has kept the requirement while investigating accessible options (`docs/accessibility-signature-proposal.md`); no alternative is approved.
- **Evidence value:** whether a drawn signature is reliable evidence in Nigerian law is for counsel (K26).
