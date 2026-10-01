import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests. Needs:
 *   npm run emulators   (seeded with npm run seed)
 *   npm run dev:emu     (the web app on :5173)
 *   .NET 8 SDK          (the acceptance test starts the check-in app in --agent mode)
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
})
