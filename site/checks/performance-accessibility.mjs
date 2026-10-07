import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run after building, against a real local Pages preview (worker + assets):
// CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
// PREVIEW_URL=http://127.0.0.1:4184 node checks/performance-accessibility.mjs
const origin = process.env.PREVIEW_URL || 'http://127.0.0.1:4184';
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
try {
  for (const path of ['/', '/city/', '/city/box/city.public-safety.chicago-police-department/', '/sources/']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('response', response => requests.push({ url: response.url(), status: response.status(), type: response.request().resourceType(), bytes: Number(response.headers()['content-length'] || 0), cache: response.headers()['cache-control'] || null }));
    page.on('pageerror', error => errors.push(error.message));
    const started = performance.now();
    const response = await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle' });
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(response?.status(), 200, `${path} status`);
    const metrics = await page.evaluate(() => ({ title: document.title, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family), navigation: performance.getEntriesByType('navigation').map(n => ({ domContentLoaded: Math.round(n.domContentLoadedEventEnd), duration: Math.round(n.duration), transferSize: n.transferSize })), resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, transferSize: r.transferSize, decodedBodySize: r.decodedBodySize })) }));
    const unnamed = await page.locator('a,button,input,select,textarea').evaluateAll(elements => elements.filter(el => el.getClientRects().length && !((el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('alt') || el.labels?.[0]?.textContent || '').trim())).map(el => el.outerHTML.slice(0, 180)));
    const heading = await page.locator('h1').allTextContents();
    assert.equal(metrics.horizontalOverflow, false, `${path} fits mobile viewport`);
    assert.deepEqual(errors, [], `${path} has no uncaught page errors`);
    assert.deepEqual(unnamed, [], `${path} has no visibly unnamed native controls`);
    results.push({ path, elapsedMs, status: response.status(), heading, unnamed, errors, requests, ...metrics });
    await context.close();
  }
  // Desktop keyboard tab order should reach the principal navigation and display a focus indicator.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const focus = [];
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    focus.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: (document.activeElement?.textContent || document.activeElement?.getAttribute('aria-label') || '').trim().slice(0, 90), outline: getComputedStyle(document.activeElement).outlineStyle, url: document.activeElement?.getAttribute('href') })));
  }
  assert.equal(focus[0]?.url, '#explore', 'skip link is first keyboard stop');
  assert.ok(focus.slice(0, 10).every(item => item.outline !== 'none'), 'early keyboard stops have visible focus rings');
  results.push({ keyboardFocus: focus });
  await page.close();
  // Consent controls are optional, but when configured must fit narrow screens,
  // expose status, and remain operable without a pointer. The browser context is
  // disposable, so the localStorage choice does not persist for a real user.
  const consentContext = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const consentPage = await consentContext.newPage();
  await consentPage.goto(origin, { waitUntil: 'networkidle' });
  const consent = consentPage.locator('[data-action-consent]');
  if (await consent.count()) {
    const allow = consent.getByRole('button', { name: 'Allow action counts' });
    const deny = consent.getByRole('button', { name: 'Do not count my actions' });
    for (const control of [allow, deny]) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 320, 'consent button fits 320px viewport');
    }
    assert.equal(await consentPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'consent does not cause horizontal overflow');
    assert.match(await consent.innerText(), /Action counts off/);
    if (await allow.isEnabled()) {
      await allow.focus();
      await consentPage.keyboard.press('Enter');
      assert.match(await consent.innerText(), /Action counts on/);
      await deny.focus();
      await consentPage.keyboard.press('Enter');
      assert.match(await consent.innerText(), /Action counts off/);
    }
    results.push({ consent: { present: true, viewport: 320, keyboardToggle: await allow.isEnabled() } });
  } else results.push({ consent: { present: false, reason: 'Analytics endpoint not configured in served build' } });
  await consentContext.close();
  // Artifacts omit preview hostname, query strings, and any browser-provided URLs.
  const redacted = results.map(result => ({ ...result,
    requests: result.requests?.map(({ url, ...request }) => ({ path: new URL(url).pathname, ...request })),
    resources: result.resources?.map(({ name, ...resource }) => ({ path: new URL(name).pathname, ...resource })),
  }));
  console.log(JSON.stringify({ origin: '<preview-origin>', chrome: browser.version(), results: redacted }, null, 2));
} finally {
  await browser.close();
}
