// Local acceptance/proxy harness, NOT a Cloudflare CPU or production latency benchmark.
// Usage: node site/checks/fallback-performance.mjs --baseline /scratch/baseline-worker.mjs [--dist site/dist]
// Extract baseline outside the repo: git show origin/main:site/public/_worker.js > /scratch/baseline-worker.mjs
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
if (args.includes('--help')) {
  console.log('Usage: node site/checks/fallback-performance.mjs --baseline /scratch/baseline-worker.mjs [--dist site/dist]');
  process.exit(0);
}
assert.ok(option('--baseline') && !option('--baseline').startsWith('--'), 'Pass --baseline path to an extracted origin/main worker (.mjs), outside the repository');
const baselinePath = resolve(option('--baseline'));
const dist = resolve(option('--dist') || new URL('../dist/', import.meta.url).pathname);
assert.ok(existsSync(join(dist, 'data/fallback/000.json')), `Missing built shards in ${dist}; run after coordinator builds the site`);
const baseline = (await import(pathToFileURL(baselinePath).href)).default;
const candidate = (await import('../public/_worker.js')).default;
assert.equal(typeof baseline?.fetch, 'function');
assert.equal(typeof candidate?.fetch, 'function');

const data = name => JSON.parse(readFileSync(join(dist, 'data', name), 'utf8'));
const manifest = data('manifest.json').chunks;
const nodeChunk = id => {
  const key = Object.keys(manifest).filter(k => id === k || id.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
  assert.ok(key, `manifest entry for ${id}`);
  return data(manifest[key]);
};
const govOf = id => id.startsWith('city-twice.') ? 'city' : id.split('.')[0];
const route = id => `/${govOf(id)}/box/${encodeURIComponent(id)}/`;
const predefined = [
  'cps.schools.district-run.network-12-total.u29181.benefits.a57305',
  'parks.parks-and-recreation.central-region.donovan-1029.corporate-fund.611010',
  'city.city-development.department-of-cultural-affairs-and-special-event.0355-special-events-and-municipal-hotel-operator.0355-2015-0005.budgeted-turnover-vacancy-savings-special-events', // signed negative
  'city-twice.services-between-funds',
  'parks.parks-and-recreation.central-region.archer-0250.corporate-fund.611005', // rounding child
  'parks.maintaining-the-parks.facilities-management-8460.corporate-fund.611005.1114-0', // cross-chunk breadcrumb
  'city.citywide.corporate-fund.0100-2005-0142.other-vendors.gladys-r-wilson-associates-pc', // child note
];
const spine = data('spine.json');
for (const id of predefined) assert.ok(nodeChunk(id).nodes.some(n => n.id === id) || spine.some(n => n.id === id), `missing fixture ${id}`);
// A small, deterministic supplement across three governments, not 100+ whole-dataset parses.
const isStatic = id => existsSync(join(dist, govOf(id), 'box', id, 'index.html'));
const samples = new Set(predefined.filter(id => !isStatic(id)));
for (const gov of ['city', 'cps', 'parks']) {
  const keys = Object.keys(manifest).filter(k => k.startsWith(`${gov}.`)).sort().slice(0, 3);
  for (const key of keys) {
    const node = data(manifest[key]).nodes.find(n => n.root === gov && n.id.includes('.') && !isStatic(n.id));
    if (node) samples.add(node.id);
  }
}

// Filesystem-backed ASSETS preserves byte content for static paths and records JSON
// transfer sizes. No redirect emulation, request cache, global parsing, or edge latency.
function assets({missing = null, staticMiss = null, transform = null} = {}) {
  const metrics = {assetReads: 0, jsonReads: 0, jsonBytes: 0, jsonPaths: []};
  return {metrics, env: {ASSETS: {async fetch(request) {
    const pathname = new URL(request.url).pathname;
    let relative;
    try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return new Response('STATIC 404', {status: 404}); }
    if (!relative || relative.split('/').some(part => part === '..' || part === '.')) return new Response('STATIC 404', {status: 404});
    let file = resolve(dist, relative);
    if (file !== dist && !file.startsWith(dist + sep)) return new Response('STATIC 404', {status: 404});
    if (pathname.endsWith('/')) file = join(file, 'index.html');
    else if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    metrics.assetReads++;
    if (pathname.startsWith('/data/') && pathname.endsWith('.json')) {
      metrics.jsonReads++;
      metrics.jsonPaths.push(pathname);
    }
    if (pathname === missing || pathname === staticMiss || !existsSync(file) || !(await stat(file)).isFile()) return new Response('STATIC 404', {status: 404});
    let body = await readFile(file);
    if (transform && pathname.startsWith('/data/')) body = transform(pathname, body);
    if (pathname.startsWith('/data/') && pathname.endsWith('.json')) metrics.jsonBytes += body.byteLength;
    return new Response(request.method === 'HEAD' ? null : body, {headers: {'Content-Type': file.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8'}});
  }}}};
}

const headers = response => Object.fromEntries(['content-type', 'x-content-type-options', 'x-robots-tag'].map(k => [k, response.headers.get(k)]));
async function run(worker, url, method = 'GET', options = {}) {
  const {env, metrics} = assets(options);
  const start = performance.now();
  const response = await worker.fetch(new Request(url, {method}), env);
  const elapsedMs = +(performance.now() - start).toFixed(3);
  return {status: response.status, headers: headers(response), body: Buffer.from(await response.arrayBuffer()), metrics, elapsedMs};
}
function compare(old, next, label) {
  assert.equal(next.status, old.status, `${label}: status`);
  assert.deepEqual(next.headers, old.headers, `${label}: response headers`);
  assert.deepEqual(next.body, old.body, `${label}: byte-for-byte body`);
}
const origin = 'https://chicagobudget.com';
const rows = [];
for (const id of samples) {
  const url = `${origin}${route(id)}`;
  const old = await run(baseline, url);
  const next = await run(candidate, url);
  compare(old, next, id);
  assert.equal(old.status, 200, `valid dynamic fixture ${id}; ensure it is not accidentally static`);
  assert.ok(old.metrics.jsonReads > 0, `dynamic fixture ${id}`);
  assert.ok(next.metrics.jsonReads > 0, `shard fixture ${id}`);
  assert.ok(next.metrics.jsonPaths.every(p => /^\/data\/fallback\/[a-f0-9]{3}\.json$/.test(p)), `${id}: bounded shard-only reads`);
  assert.equal(next.metrics.jsonReads, 1, `${id}: exactly one JSON shard read`);
  if (id === predefined[2]) assert.match(next.body.toString(), /-\$[\d,.]+/, 'negative value is rendered');
  if (id === predefined[4]) assert.match(next.body.toString(), /\(rounding\)/, 'rounding child is rendered');
  if (id === predefined[6]) assert.match(next.body.toString(), /Matched to this line/, 'child note is rendered');
  rows.push({id, baseline: {...old.metrics, elapsedMs: old.elapsedMs}, optimized: {...next.metrics, elapsedMs: next.elapsedMs}});
  for (const method of ['HEAD']) compare(await run(baseline, url, method), await run(candidate, url, method), `${id} HEAD`);
}
// City-twice is currently prerendered. Force an ASSETS 404 so its fallback
// record and special root/breadcrumb logic are compared rather than skipped.
if (isStatic(predefined[3])) {
  const url = `${origin}${route(predefined[3])}`;
  for (const method of ['GET', 'HEAD']) {
    const old = await run(baseline, url, method, {staticMiss: route(predefined[3])});
    const next = await run(candidate, url, method, {staticMiss: route(predefined[3])});
    compare(old, next, `forced City-twice fallback ${method}`);
    assert.equal(next.status, 200);
    assert.equal(next.metrics.jsonReads, 1);
  }
}

const paths = [
  '/city/box/city.nonexistent-audit-id/', '/cps/box/city.public-safety/',
  // URL parsing normalizes encoded '..' before the worker sees it; '...' stays malformed.
  '/parks/box/%2e%2e%2e/', '/city/box/city.%2Fsecret/', '/city/box/%ZZ/',
  '/city/box/city.%3Cscript%3E/', '/city/box/city..oops/', '/city/box/city.not-real-seo/extra/',
];
let unknownCost;
for (const path of paths) for (const method of ['GET', 'HEAD']) {
  const url = `${origin}${path}`;
  const old = await run(baseline, url, method);
  const next = await run(candidate, url, method);
  compare(old, next, `${method} ${path}`);
  assert.equal(next.status, 404, `${method} ${path}`);
  if (path === paths[0] && method === 'GET') {
    assert.equal(next.metrics.jsonReads, 1, 'well-formed unknown ID makes exactly one shard read');
    unknownCost = {baseline: old.metrics, optimized: next.metrics};
  }
}
for (const host of ['preview.chicagobudget.pages.dev', 'localhost']) {
  for (const path of [route(predefined[0]), paths[0]]) {
    const old = await run(baseline, `https://${host}${path}`);
    const next = await run(candidate, `https://${host}${path}`);
    compare(old, next, `${host}${path}`);
    assert.equal(next.headers['x-robots-tag'], 'noindex');
  }
}
// Static precedence and original bytes, including HEAD, are asserted against the disk too.
for (const path of ['/city/box/city.public-safety/', ...(isStatic(predefined[3]) ? [route(predefined[3])] : []), '/data/manifest.json']) {
  const disk = await readFile(join(dist, path.endsWith('/') ? `${path}index.html` : path));
  for (const method of ['GET', 'HEAD']) {
    const old = await run(baseline, `${origin}${path}`, method);
    const next = await run(candidate, `${origin}${path}`, method);
    compare(old, next, `${method} static ${path}`);
    assert.deepEqual(next.body, method === 'HEAD' ? Buffer.alloc(0) : disk);
    assert.equal(next.metrics.assetReads, 1, `static precedence ${path}`);
  }
}
// Simulate one failed JSON upstream fetch, then retry on the SAME imported worker:
// the retry must render successfully, rather than cache a transient 404/503.
const retryId = predefined[0];
const retryUrl = `${origin}${route(retryId)}`;
const shard = (() => { let hash = 2166136261; for (const byte of Buffer.from(retryId)) hash = Math.imul(hash ^ byte, 16777619) >>> 0; return (hash & 511).toString(16).padStart(3, '0'); })();
// Published export has no multi-source nodes. Mutate both inputs to exercise
// array-source rendering with two genuine public citations.
const citations = data('sources.json').filter(Boolean).slice(0, 2);
assert.equal(citations.length, 2);
const chunkKey = Object.keys(manifest).filter(k => retryId === k || retryId.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
const chunkPath = `/data/${manifest[chunkKey]}`;
const modified = (path, body) => {
  if (path !== chunkPath && path !== `/data/fallback/${shard}.json`) return body;
  const payload = JSON.parse(body.toString());
  if (path === chunkPath) {
    const node = payload.nodes.find(n => n.id === retryId);
    assert.ok(node);
    node.source = [0, 1];
  } else {
    assert.ok(payload.records[retryId]);
    payload.records[retryId][0].source = [0, 1];
    payload.records[retryId][3] = citations;
  }
  return Buffer.from(JSON.stringify(payload));
};
const oldMulti = await run(baseline, retryUrl, 'GET', {transform: modified});
const newMulti = await run(candidate, retryUrl, 'GET', {transform: modified});
compare(oldMulti, newMulti, 'injected source array with two citations');
for (const citation of citations) assert.ok(newMulti.body.includes(Buffer.from(citation.name || citation.doc || citation.dataset)), 'both citations rendered');
const failedOld = await run(baseline, retryUrl, 'GET', {missing: '/data/manifest.json'});
const failedNew = await run(candidate, retryUrl, 'GET', {missing: `/data/fallback/${shard}.json`});
compare(failedOld, failedNew, 'missing upstream JSON');
assert.equal(failedNew.status, 503);
compare(await run(baseline, retryUrl), await run(candidate, retryUrl), 'successful retry after failed upstream');

const totals = rows.reduce((o, row) => {
  for (const side of ['baseline', 'optimized']) for (const key of ['jsonReads', 'jsonBytes', 'assetReads', 'elapsedMs']) o[side][key] += row[side][key];
  return o;
}, {baseline: {jsonReads: 0, jsonBytes: 0, assetReads: 0, elapsedMs: 0}, optimized: {jsonReads: 0, jsonBytes: 0, assetReads: 0, elapsedMs: 0}});
console.log(JSON.stringify({note: 'Local Node wall-clock plus filesystem I/O and JSON asset read/byte proxies only, NOT Cloudflare CPU, production latency, or billed subrequests.', samples: rows.length, totals, unknownCost, rows}, null, 2));
