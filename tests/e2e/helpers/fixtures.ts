import { test as base } from '@playwright/test';
import { firebaseSignInAvailable, makeGroup, type Group } from './app';

let signIn: Promise<boolean> | null = null;

/**
 * `group(names)` = real Firebase phones (one browser context each). The first creates the household, the rest join by invite link.
 * On failure, a screenshot of every phone is attached BEFORE the household is deleted at the end of the test.
 */
export const test = base.extend<{ group: (names: string[]) => Promise<Group> }>({
  group: async ({ browser }, use, testInfo) => {
    const made: Group[] = [];
    await use(async (names) => {
      signIn ??= firebaseSignInAvailable();
      if (!(await signIn)) throw new Error('Firebase anonymous sign-in is OFF for the project (ADMIN_ONLY_OPERATION): these tests cannot run until it is enabled in the console.');
      const g = await makeGroup(browser, testInfo, names);
      made.push(g);
      return g;
    });
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const g of made) {
        for (const [i, page] of g.pages.entries()) {
          try {
            await testInfo.attach(`phone-${i + 1}.png`, { body: await page.screenshot({ timeout: 5000 }), contentType: 'image/png' });
          } catch {
            /* page may be gone */
          }
        }
      }
    }
    for (const g of made) await g.cleanup();
  },
});

export { expect } from '@playwright/test';
