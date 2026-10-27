# Capture failures (Frontend redesign)

None: every attempted page/state produced a screenshot in both viewports.

Pages that redirect (for example an anonymous visitor to /login) are real rendered states and are noted in the inventory, not counted as failures. Screens that need fixtures the audit does not create (real payment provider pages, real map tiles, a hosted file store) are not captured and are listed in docs/known-issues.md.
