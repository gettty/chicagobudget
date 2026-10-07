import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import worker from '../public/_worker.js';

const base = new URL('../public/', import.meta.url);
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
const assets = {ASSETS: {async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/city/box/city.public-safety/') return new Response('PRERENDERED', {status: 200});
  if (url.pathname === '/data/manifest.json' || url.pathname === '/data/spine.json' || url.pathname === '/data/sources.json' || /^\/data\/chunks\/[a-f0-9]+\.json$/.test(url.pathname)) {
    const path = join(base.pathname, url.pathname);
    if (existsSync(path)) return new Response(readFileSync(path), {headers: {'Content-Type': 'application/json'}});
  }
  return new Response('STATIC 404', {status: 404});
}}};
const request = (path, method = 'GET') => worker.fetch(new Request(`https://chicagobudget.com${path}`, {method}), assets);

test('box routes are isolated from static data and redirect rewrites', () => {
  assert.deepEqual(routes.include, ['/city/box/*', '/cps/box/*', '/parks/box/*']);
  assert.ok(!redirects.includes('/box-shell/'));
  assert.ok(redirects.includes('/methods/ /methods 301'));
  assert.ok(redirects.includes('/style-guide / 301'));
});

test('existing static HTML takes precedence without modification', async () => {
  const response = await request('/city/box/city.public-safety/');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'PRERENDERED');
});

test('real deep fallback nodes in each government expose figures, provenance, links and canonical', async () => {
  for (const gov of ['city', 'cps', 'parks']) {
    const node = Object.entries(manifest.chunks).filter(([k]) => k.startsWith(`${gov}.`)).map(([, file]) => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url))).nodes.find(n => n.root === gov && n.depth >= 5 && n.source != null)).find(Boolean);
    assert.ok(node, `sample for ${gov}`);
    const response = await request(`/${gov}/box/${node.id}/`);
    const html = await response.text();
    assert.equal(response.status, 200, node.id);
    assert.ok(html.includes(node.name.replaceAll('&', '&amp;')), node.id);
    assert.match(html, /Exact|\$[\d,.]+/);
    assert.ok(html.includes(`https://chicagobudget.com/${gov}/box/${node.id}/`));
    assert.match(html, /Breadcrumb|Inside this box/);
    assert.match(html, /<h2>Sources<\/h2>/);
    assert.match(html, /Open interactive view/);
    assert.match(html, /independent project/);
    const head = await request(`/${gov}/box/${node.id}/`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
});

test('unknown, cross-government, encoded traversal and malformed paths never become shell 200s', async () => {
  for (const path of ['/city/box/city.not-real-seo/', '/cps/box/city.public-safety/', '/parks/box/%2e%2e/', '/city/box/city.%2Fsecret/', '/city/box/%ZZ/', '/city/box/city.%3Cscript%3E/', '/city/box/city..oops/']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.match(await response.text(), /Budget box not found|STATIC 404/);
  }
  const data = await request('/data/manifest.json');
  assert.equal(data.status, 200);
  assert.ok((await data.json()).chunks);
});

test('City counted-twice memo descendants keep their own root and parent breadcrumb', async () => {
  const response = await request('/city/box/city-twice.services-between-funds/');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /One city fund paying another for services/);
  assert.match(html, /href="\/city\/counted-twice\/"/);
  assert.match(html, /https:\/\/chicagobudget.com\/city\/box\/city-twice.services-between-funds\//);
  assert.match(html, /#box=city-twice.services-between-funds/);
});

test('spine-only ancestors link to real government paths and Parks uses calendar year', async () => {
  const spine = JSON.parse(readFileSync(new URL('../public/data/spine.json', import.meta.url)));
  const ancestor = spine.find(n => n.id === 'parks.maintaining-the-parks');
  assert.ok(ancestor && !ancestor.root, 'ancestor is represented by a rootless spine record');
  const response = await request('/parks/box/parks.maintaining-the-parks.facilities-management-8460.corporate-fund.611005.1114-0/');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /href="\/parks\/"/);
  assert.match(html, /href="\/parks\/box\/parks.maintaining-the-parks\/"/);
  assert.ok(!html.includes('/undefined/'));
  assert.match(html, /Calendar year 2026/);
  assert.ok(!html.includes('FY2026'));
});

test('published caveats, notes and source details are escaped and visible', async () => {
  const id = 'city.health.corporate-fund.0100-2005-0045.met-life';
  const response = await request(`/city/box/${id}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /midyear_2025_coding/);
  const sourceAssets = {ASSETS: {async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/data/sources.json') {
      const sources = JSON.parse(readFileSync(new URL('../public/data/sources.json', import.meta.url)));
      sources[297] = {name: '<Official & source>', page: '12 < 13', note: 'Note & context', url: 'https://example.org/?a=1&b=2'};
      return Response.json(sources);
    }
    return assets.ASSETS.fetch(req);
  }}};
  const memo = await worker.fetch(new Request('https://chicagobudget.com/city/box/city-twice.services-between-funds/'), sourceAssets);
  const html = await memo.text();
  assert.match(html, /&lt;Official &amp; source&gt;/);
  assert.match(html, /page 12 &lt; 13/);
  assert.match(html, /Note &amp; context/);
  assert.match(html, /https:\/\/example.org\/\?a=1&amp;b=2/);
});

test('missing export assets return retryable 503, not a false 404', async () => {
  const broken = {ASSETS: {fetch(req) {
    if (new URL(req.url).pathname === '/data/manifest.json') return new Response('missing', {status: 404});
    return assets.ASSETS.fetch(req);
  }}};
  const response = await worker.fetch(new Request('https://chicagobudget.com/parks/box/parks.maintaining-the-parks.facilities-management-8460.corporate-fund.611005.1114-0/'), broken);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /retry this page/);
});
