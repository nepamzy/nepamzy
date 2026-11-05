import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Cloud sandbox ships a pre-installed Chromium; elsewhere Playwright's own browser is used.
const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
]
const chromiumPath = candidates.find((p): p is string => Boolean(p) && existsSync(p as string))

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  // Several journeys sign in 3 to 5 roles and walk many screens; CI runners are slower than a developer machine, and two
  // different long tests exceeded the 30 s default on otherwise identical commits. Individual expectations keep their own short timeouts.
  // On CI the whole run has taken from 40 to 66 minutes depending on the runner, so one slow test passing 90 s there is a slow
  // runner, not a wrong answer: CI gets more room, a developer machine keeps the stricter limit.
  timeout: process.env.CI ? 150_000 : 90_000,
  retries: 0,
  reporter: [['list']],
  // A click or fill waits for its element until the whole test times out, so one stuck step hides which step it was. 20 s per
  // action makes a stuck step fail with its own name and what it was waiting for, in the CI log.
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'mobile-360',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 740 },
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm build && pnpm start -H 127.0.0.1 -p 3000',
      url: 'http://127.0.0.1:3000/',
      reuseExistingServer: true,
      timeout: 240000,
    },
    {
      // Local stand-in for Paystack test mode (signs webhooks with the same test secret the app uses)
      command: 'node --env-file=.env.local scripts/fake-paystack.mjs',
      url: 'http://127.0.0.1:3002/health',
      reuseExistingServer: true,
      timeout: 30000,
      ignoreHTTPSErrors: true,
    },
  ],
})
