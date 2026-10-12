// Dev-only: checks the production build's service worker (needs `npm run build` + `vite preview --port 4173`).
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const U = 'http://localhost:4173/pick-tonight/?catalog=fixture&sync=memory';
await page.goto(U);
await page.getByTestId('welcome').waitFor();
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForTimeout(800);
console.log('controlled:', await page.evaluate(() => !!navigator.serviceWorker.controller));
console.log('caches:', await page.evaluate(async () => (await caches.keys()).join(',')));
await ctx.setOffline(true);
await page.reload();
await page.getByTestId('welcome').waitFor({ timeout: 8000 });
console.log('offline reload OK');
await ctx.setOffline(false);
await browser.close();
