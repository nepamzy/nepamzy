# Proposal for an accessible delivery-proof path (for owner review; nothing here is implemented)

**Current rule (kept):** a drawn signature is mandatory; typed acknowledgement is not an approved substitute; only the account holder completes a delivery; the proof token stays hidden from the rider; no QR proof. This proposal does not change those rules.

**The gap:** a recipient who cannot draw (motor impairment, no touch/stylus, assistive-technology user) cannot complete the proof in the app. Today the only way out is "Get help from support" and the support exception path, which opens a report and releases the parcel; support cannot mark an order delivered.

## Options (none chosen)

| Option                                                      | Idea                                                                                                                              | Pros                             | Cons / needs                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A. Keep as is, document the exception path                  | Support handles recipients who cannot sign                                                                                        | No policy change                 | Slow, depends on staffing; recipient is not served in the moment                                             |
| B. Keyboard-operable drawing alternative                    | A way to produce a stroke with arrow keys / switch access in the same canvas                                                      | Still a "drawn" signature        | Unusual interaction, weak evidential value, needs design and user testing                                    |
| C. A second, equally strong proof for recipients who opt in | For example a one-time code the recipient receives in their own app session plus a recorded confirmation, bound to the assignment | Accessible; tokens already exist | **This is a change to the proof policy**: needs owner, AFIT and legal approval; do not build before approval |
| D. Assisted signing                                         | The recipient authorises a named helper present at handover                                                                       | Matches real life                | Identity and evidence questions; legal review                                                                |

## Questions for the owner (and AFIT / counsel where noted)

1. Which option, if any, is acceptable as proof of receipt? (owner + counsel)
2. Is a typed acknowledgement ever acceptable, and for whom? (owner + counsel; today: no)
3. How long are signatures kept, who may see them, and is a signature viewer for staff wanted (K26, K51)? (owner + counsel)
4. Who tests a new path with real users of assistive technology before launch? (owner)

Whatever is chosen would need new database tests (the proof must stay one-time, expiring and assignment-bound) and a person-led accessibility review.
