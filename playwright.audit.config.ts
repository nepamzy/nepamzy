import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Screenshot audit (docs/reports/afit-market-visual-audit.md). Reuses the e2e projects (mobile 360 wide, desktop) but
 * overrides their viewports to the audit sizes. It only READS the running application; it changes no design.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/visual-audit',
  timeout: 1_500_000,
  projects: (base.projects ?? []).map((p) => ({
    ...p,
    use: {
      ...p.use,
      viewport: p.name === 'desktop' ? { width: 1440, height: 900 } : { width: 360, height: 800 },
    },
  })),
})
