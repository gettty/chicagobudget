import test from 'node:test';
import assert from 'node:assert/strict';
import { handleActionEvent } from '../public/_worker.js';

const url = 'https://chicagobudget.com/_events';
const rows = [];
const env = { ACTION_ANALYTICS_ENABLED: 'true', ACTION_COUNTS: {
  prepare(sql) {
    assert.match(sql, /ON CONFLICT\(day, action, gov\)/);
    return { bind(...values) { return { async run() { rows.push(values); } }; } };
  },
} };
const request = (body, headers = {}, destination = url) => new Request(destination, {
  method: 'POST', headers: { Origin: 'https://chicagobudget.com', 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
test('endpoint accepts only bounded enum payload and stores daily aggregate dimensions', async () => {
  rows.length = 0;
  const result = await handleActionEvent(request({ action: 'budget_open', gov: 'city' }), env);
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.match(rows[0][0], /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(rows[0].slice(1), ['budget_open', 'city']);
  for (const body of [
    { action: 'budget_open', gov: 'city', url: 'https://example.org/?person=private' },
    { action: 'other', gov: 'city' },
    { action: 'budget_open', gov: 'person' },
    'x'.repeat(129),
  ]) assert.ok([400, 413].includes((await handleActionEvent(request(body), env)).status));
  assert.equal(rows.length, 1);
});
test('endpoint rejects cross-site, query, DNT and unconfigured storage', async () => {
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }), { ACTION_COUNTS: env.ACTION_COUNTS })).status, 503);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }), { ...env, ACTION_ANALYTICS_ENABLED: 'false' })).status, 503);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }, { Origin: 'https://elsewhere.test' }), env)).status, 403);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }, {}, url + '?search=private'), env)).status, 403);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }, { 'Sec-GPC': '1' }), env)).status, 204);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }), { ACTION_ANALYTICS_ENABLED: 'true' })).status, 503);
  assert.equal((await handleActionEvent(new Request(url), env)).status, 405);
  const preview = 'https://abc.chicagobudget.pages.dev/_events';
  const previewRequest = () => request({ action: 'budget_open', gov: 'none' }, { Origin: 'https://abc.chicagobudget.pages.dev' }, preview);
  assert.equal((await handleActionEvent(previewRequest(), env)).status, 403);
  assert.equal((await handleActionEvent(previewRequest(), { ...env, ACTION_ANALYTICS_PREVIEW: 'true', CF_PAGES_BRANCH: 'main' })).status, 403);
  assert.equal((await handleActionEvent(previewRequest(), { ...env, ACTION_ANALYTICS_PREVIEW: 'true', CF_PAGES_BRANCH: 'seo-preview' })).status, 204);
  assert.equal((await handleActionEvent(request({ action: 'budget_open', gov: 'none' }, { Origin: 'https://other.pages.dev' }, 'https://other.pages.dev/_events'), { ...env, ACTION_ANALYTICS_PREVIEW: 'true', CF_PAGES_BRANCH: 'seo-preview' })).status, 403);
});
