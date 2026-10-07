// Run against an already-running assembled Pages server:
// PREVIEW_URL=http://127.0.0.1:8788 node site/tests/seo-browser.mjs
// Optional: CHROMIUM_PATH=/path/to/chrome PLAYWRIGHT_MODULE=playwright
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.PREVIEW_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ viewport, javaScriptEnabled });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const visit = async path => {
          const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
          assert.equal(response.status(), 200, path);
          assert.ok(await page.locator('main h1').count(), `${path}: missing heading`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}: horizontal overflow at ${viewport.width}px`);
        };
        await visit('/');
        const home = await page.locator('main').innerText();
        assert.match(home, /Chicago/i);
        assert.match(home, /\$[\d,.]+/);
        for (const path of ['/city/', '/cps/', '/parks/', '/datasets/', '/guides/']) {
          assert.ok(await page.locator(`a[href="${path}"]`).count(), `homepage missing ${path}`);
        }
        await visit('/datasets/');
        const dataset = page.locator('main a[href^="/datasets/2026/"]').first();
        assert.ok(await dataset.count(), 'dataset index links');
        await dataset.click();
        assert.match(page.url(), /\/datasets\/2026\//);
        assert.ok((await page.locator('main').innerText()).length > 250);
        await visit('/guides/');
        const guide = page.locator('main a[href^="/guides/"]').first();
        assert.ok(await guide.count(), 'guide index links');
        await guide.click();
        assert.match(page.url(), /\/guides\/[^/]+\//);
        assert.ok((await page.locator('main').innerText()).length > 250);
        if (javaScriptEnabled) {
          await visit('/find');
          await page.locator('#government').selectOption('city');
          await page.locator('#query').fill('Chicago Police Department');
          await page.locator('#results a').first().waitFor({ timeout: 15000 });
          assert.ok(await page.locator('#results a[href^="/city/box/"]').count(), 'search lacks city box results');
          await page.locator('#results a[href^="/city/box/"]').first().click();
          assert.ok(await page.locator('main h1').count(), 'search result navigation failed');
        }
        assert.deepEqual(errors, [], `browser errors at ${viewport.width}px, JS ${javaScriptEnabled}`);
      } finally {
        await context.close();
      }
    }
  }
  console.log('SEO browser: desktop/mobile, JS on/off, crawlable homepage, datasets, guides, search, overflow/errors OK');
} finally {
  await browser.close();
}
