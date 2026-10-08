import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {fallbackBucket} from '../public/_worker.js';

const id = 'city.public-safety';
const node = {id, root: 'city', name: 'Safety <test>', amount_cents: 12345, basis: 'budget', note: 'Safe & public'};
const payload = {version: 1, records: {[id]: [node, [{id: `${id}.child`, root: 'city', name: 'Child', amount_cents: 50}], [{id: 'city', root: 'city', name: 'City'}], [{name: 'Source', url: 'https://example.org/report'}]]}};
const path = `/data/fallback/${fallbackBucket(id)}.json`;
const url = `https://chicagobudget.com/city/box/${id}/`;
const request = (method = 'GET', destination = url) => new Request(destination, {method});
const assets = (shard = payload) => {
  const calls = [];
  return {calls, ASSETS: {async fetch(req) {
    const pathname = new URL(req.url).pathname;
    calls.push(pathname);
    if (/^\/data\/fallback\/[a-f0-9]{3}\.json$/.test(pathname) && shard !== null) return Response.json(shard);
    return new Response(null, {status: 404});
  }}};
};

test('hash matches generator and fallback reads just one compact shard', async () => {
  assert.equal(fallbackBucket(id), '00e');
  const env = assets();
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Safety &lt;test&gt;/);
  assert.match(html, /Safe &amp; public/);
  assert.match(html, /https:\/\/example.org\/report/);
  assert.deepEqual(env.calls, [`/city/box/${id}/`, path]);
  const head = await worker.fetch(request('HEAD'), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('valid unknown ID is 404, missing or corrupt shard 503, invalid ID 404 without data fetch', async () => {
  const unknown = 'city.not-published';
  assert.equal((await worker.fetch(request('GET', `https://chicagobudget.com/city/box/${unknown}/`), assets({version: 1, records: {}}))).status, 404);
  assert.equal((await worker.fetch(request(), assets(null))).status, 503);
  assert.equal((await worker.fetch(request(), assets({version: 99, records: {}}))).status, 503);
  const invalid = assets(null);
  assert.equal((await worker.fetch(request('GET', 'https://chicagobudget.com/city/box/city..bad/'), invalid)).status, 404);
  assert.equal(invalid.calls.length, 1);
});

test('preview noindex, static precedence, and concurrent environment isolation', async () => {
  const preview = await worker.fetch(request('GET', `https://branch.chicagobudget.pages.dev/city/box/${id}/`), assets());
  assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex');
  const [present, missing] = await Promise.all([worker.fetch(request(), assets()), worker.fetch(request(), assets(null))]);
  assert.deepEqual([present.status, missing.status], [200, 503]);
  const staticEnv = {ASSETS: {fetch: async () => new Response('pre-rendered')}};
  assert.equal(await (await worker.fetch(request(), staticEnv)).text(), 'pre-rendered');
});
