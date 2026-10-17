# Manual test script: rider location on real Android devices (STATUS: UNVERIFIED)

**Why this exists.** A web app (PWA) cannot be assumed to keep collecting GPS when an Android phone locks its screen or the browser goes to the background. Batch 4 builds foreground tracking with a screen wake-lock request and guidance ("keep this screen open"). **Background tracking is UNVERIFIED** until someone runs this script on the target phones and records the result. If it fails, stop and report the evidence to the owner: a dedicated rider app is a cost/scope decision that is **not** taken without explicit owner approval.

**Safety.** Use synthetic or test delivery points only. Do not test inside restricted areas. Use test accounts, never real customers. Nothing here needs real AFIT coordinates; the app's sample delivery points are in open sea.

## Setup

1. A staging/local build reachable from the phone over HTTPS (geolocation needs a secure context). Note the URL: ______
2. Phone model: ______ Android version: ______ Browser (Chrome version): ______ Installed as PWA? yes / no
3. Battery saver OFF for run A, ON for run B. Location mode: High accuracy.
4. Test rider account approved, terms accepted. A test customer with a delivery order in `AWAITING_RIDER`.

## Runs (do each, record the result)

| #   | Scenario                     | Steps                                                                                   | Expected                                                                                  | Result | Notes |
| --- | ---------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | ----- |
| A1  | Foreground, screen on        | Go Active, accept order, vendor hands over, Start route. Walk 5 minutes with Jobs open. | Customer map moves; "Location sharing ON"; last-sent time advances                        |        |       |
| A2  | Screen auto-lock             | As A1, but let the screen lock after 30 s. Wait 3 minutes, unlock.                      | Record whether positions arrived while locked (check `rider_location_history` timestamps) |        |       |
| A3  | App switched                 | As A1, switch to another app for 3 minutes, return.                                     | Record gap in history; customer shows "out of date" during the gap                        |        |       |
| A4  | Wake lock                    | As A1 with the screen kept on by the page only (set device timeout to 30 s).            | Screen stays on while the Jobs page is open                                               |        |       |
| B1  | Battery saver ON             | Repeat A1–A3.                                                                           | Record behaviour                                                                          |        |       |
| C1  | Permission denied            | Deny location when asked.                                                               | Clear message; nothing stored; rider can report a GPS problem                             |        |       |
| C2  | Permission revoked mid-shift | Revoke in site settings during A1.                                                      | Message appears; sharing stops; no crash                                                  |        |       |
| D1  | Go Inactive                  | Finish/handover or release, then Go Inactive.                                           | "Location sharing OFF"; no further rows                                                   |        |       |
| E1  | Airplane mode                | Disable data for 60 s then re-enable.                                                   | Positions resume; stale flag shown meanwhile                                              |        |       |
| F1  | Accuracy                     | Stand indoors, then outdoors.                                                           | Fixes worse than the accuracy limit are not used; arrival is not detected from them       |        |       |

## How to read the evidence

- `select observed_at, received_at, accuracy_m from rider_location_history where rider_id = '<id>' order by id;` (staff/DBA only)
- A gap longer than the stale threshold (default 45 s) while the screen is locked means **background tracking does not work on that device/browser**.

## Decision rule

- All of A1 + A4 pass and A2/A3 show continuous positions: record "PWA background tracking works on <devices>" (still requires owner sign-off).
- A2/A3 show gaps: record "PWA tracking works only in the foreground; riders must keep the screen on" and **tell the owner**. Do not build a native app without approval.
