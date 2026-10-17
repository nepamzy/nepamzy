import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Full-platform screenshot audit (artifacts/afit-market-ui-audit). Desktop 1440x900 and mobile 390x844.
 * Set UI_AUDIT_PHASE=before|after. It only READS the running application with synthetic local data.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/visual-audit',
  testMatch: /ui-audit\.spec\.ts/,
  timeout: 1_500_000,
  projects: (base.projects ?? []).map((p) => ({
    ...p,
    use: {
      ...p.use,
      viewport: p.name === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      deviceScaleFactor: p.name === 'desktop' ? 1 : 1.5,
    },
  })),
})
