import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_PATH = '/mosaic/';

/**
 * End-to-end tests run against a production build served under the same sub-path as GitHub Pages.
 * Locally you can reuse an installed browser: PW_CHANNEL=chrome npm test
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 393, height: 826 },
        channel: process.env.PW_CHANNEL || undefined,
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    env: { BASE_PATH },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
