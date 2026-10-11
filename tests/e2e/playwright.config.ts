import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. They run against the REAL production build (served by `vite preview`)
 * at iPhone size in WebKit (closest thing to iPhone Safari).
 *
 *   npm run e2e                  -> WebKit / iPhone 14 (the one that matters)
 *   E2E_CHROMIUM=1 npm run e2e   -> also run everything in Chromium at Pixel 7 size
 */
const projects = [
  {
    name: 'iphone-webkit',
    use: { ...devices['iPhone 14'], serviceWorkers: 'block' as const },
  },
];
if (process.env.E2E_CHROMIUM) {
  projects.push({ name: 'android-chromium', use: { ...devices['Pixel 7'], serviceWorkers: 'block' as const } });
}

export default defineConfig({
  testDir: './specs',
  outputDir: '../../test-results',
  timeout: 120_000, // some tests page through several whole decks
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  retries: 0, // Firebase tests opt in to one retry themselves (network flake only)
  reporter: [['list'], ['html', { outputFolder: '../../playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects,
  webServer: {
    command: 'node tests/e2e/free-port.mjs && npm run build && npm run preview -- --port 4173 --strictPort',
    cwd: '../..',
    url: 'http://localhost:4173/pick-tonight/',
    // A server left over from an earlier run serves a stale file list after any rebuild, so always start fresh.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
