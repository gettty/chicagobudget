import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyLink, createActionTracker, installActionTracking } from '../src/lib/actionAnalytics.mjs';

const base = 'https://chicagobudget.com/?q=private-person';
test('only allowlisted, coarse action classes are emitted', () => {
  assert.equal(classifyLink('/city/box/city.foo?name=private', base), 'budget_open');
  assert.equal(classifyLink('/cps/', base), 'budget_open');
  assert.equal(classifyLink('https://www.chicago.gov/doc.pdf?person=private', base), 'official_source_follow');
  assert.equal(classifyLink('https://github.com/example/data/blob/main/budget.csv?token=secret', base), 'dataset_download');
  assert.equal(classifyLink('https://evil.example/data.csv', base), null);
  assert.equal(classifyLink('javascript:alert(1)', base), null);
});
test('disabled by default, explicit consent, bounded payload, per-action dedupe', () => {
  let consent = false, time = 10;
  const sent = [];
  const track = createActionTracker({ endpoint: '/api/action-count', consent: () => consent, now: () => time, send: (...args) => sent.push(args) });
  assert.equal(track('budget_open'), false);
  consent = true;
  assert.equal(track('budget_open'), true);
  assert.equal(track('budget_open'), false);
  assert.equal(track('dataset_download'), true);
  assert.equal(track('person=private'), false);
  time += 1500;
  assert.equal(track('budget_open'), true);
  assert.deepEqual(sent.map(([path, body]) => [path, JSON.parse(body)]), [
    ['/api/action-count', { action: 'budget_open', gov: 'none' }],
    ['/api/action-count', { action: 'dataset_download', gov: 'none' }],
    ['/api/action-count', { action: 'budget_open', gov: 'none' }],
  ]);
  assert.equal(createActionTracker({ endpoint: 'https://collector.test/events', consent: () => true, send: () => assert.fail() })('budget_open'), false);
});
test('two frontend installations on one page share a single listener and no default beacon', async () => {
  let count = 0;
  const requests = [];
  const copied = [];
  const win = {
    location: { href: base, origin: 'https://chicagobudget.com', pathname: '/city/box/example/' },
    navigator: { clipboard: { writeText: (value) => { copied.push(value); return Promise.resolve(); } } },
    localStorage: { getItem: () => 'yes' },
    fetch: (...args) => { requests.push(args); return Promise.resolve(); },
    document: { readyState: 'loading', addEventListener: () => {} },
  };
  // Capture only the delegated click handler, independent of DOM implementation.
  const handlers = [];
  win.document.addEventListener = (_, handler) => { count++; handlers.push(handler); };
  installActionTracking(win, '/api/actions');
  installActionTracking(win, '/api/actions');
  assert.equal(count, 2); // one click listener and one one-shot consent mount
  const anchor = { matches: () => false, getAttribute: () => '/parks/box/example' };
  handlers[0]({ target: { closest: () => anchor } });
  handlers[0]({ target: { closest: () => anchor } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1].referrerPolicy, 'no-referrer');
  assert.equal(requests[0][1].credentials, 'omit');
  handlers[0]({ target: { closest: () => ({ matches: () => true }) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ['https://chicagobudget.com/city/box/example/']);
  assert.equal(JSON.parse(requests[1][1].body).action, 'permalink_share');
  assert.equal(readFileSync(new URL('../src/lib/actionAnalytics.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../lakefront/src/lib/actionAnalytics.js', import.meta.url), 'utf8'));
  for (const file of ['../src/layouts/Base.astro', '../../lakefront/vite.config.js']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /static\.cloudflareinsights\.com|data-cf-beacon/);
  }
});
test('consent UI is opt-in, revocable, and respects browser privacy signals', () => {
  const listeners = {};
  const stored = new Map();
  const children = [];
  const element = () => ({ setAttribute() {}, addEventListener(name, callback) { this[name] = callback; }, append(...items) { this.children = items; }, textContent: '' });
  const win = {
    location: { href: base, origin: 'https://chicagobudget.com', pathname: '/' },
    navigator: { globalPrivacyControl: false, doNotTrack: '0' },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    fetch: () => Promise.resolve(),
    document: {
      readyState: 'complete', body: { append: child => children.push(child) },
      querySelector: () => null, createElement: element,
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
  };
  const track = installActionTracking(win, '/_events');
  assert.equal(children.length, 1);
  const [, status, yes, no] = children[0].children;
  assert.equal(status.textContent, 'Action counts off.');
  assert.equal(track('budget_open'), false);
  yes.click();
  assert.equal(status.textContent, 'Action counts on.');
  assert.equal(track('budget_open'), true);
  no.click();
  assert.equal(track('dataset_download'), false);
  yes.click();
  win.navigator.globalPrivacyControl = true;
  assert.equal(track('official_source_follow'), false);
  assert.equal(listeners.click instanceof Function, true);
});
