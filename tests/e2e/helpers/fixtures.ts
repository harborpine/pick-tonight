import { test as base } from '@playwright/test';
import { makePairedPhones, type Pair } from './app';

/**
 * `pair` = two freshly paired phones on the real Firebase project (HG = A, BG = B).
 * On failure, screenshots of both phones are attached BEFORE the household is cleaned up.
 */
export const test = base.extend<{ pair: Pair }>({
  pair: async ({ browser }, use, testInfo) => {
    const u = testInfo.project.use;
    const pair = await makePairedPhones(browser, {
      viewport: u.viewport,
      userAgent: u.userAgent,
      deviceScaleFactor: u.deviceScaleFactor,
      isMobile: u.isMobile,
      hasTouch: u.hasTouch,
      serviceWorkers: 'block',
      baseURL: u.baseURL ?? 'http://localhost:4173',
    });
    await use(pair);
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const [name, page] of [['HG-phone', pair.A], ['BG-phone', pair.B]] as const) {
        try {
          await testInfo.attach(`${name}.png`, { body: await page.screenshot({ timeout: 5000 }), contentType: 'image/png' });
        } catch {
          /* page may be gone */
        }
      }
    }
    await pair.cleanup();
  },
});

export { expect } from '@playwright/test';
