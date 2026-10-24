import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests: real browsers playing the game, offline and against the local Realtime Database
 * emulator. `npm run test:e2e` starts the emulator around Playwright (see README); a plain
 * `npx playwright test` runs the offline specs and skips the online ones when no emulator is up.
 */

// Not the reference repo's 5174: with reuseExistingServer, a run here could otherwise test that
// project's dev server if it happens to be up.
const PORT = 5176;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/support/global-setup.ts',
  // Several WebGL browsers on a software renderer; give them room.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Each browser renders WebGL on the CPU (SwiftShader) and some tests open three: more than 3 workers starve
  // them and timing-sensitive online specs start to fail.
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 540 },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 540 },
        launchOptions: {
          // WebGL without a GPU, and sound without a click first.
          args: [
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
