import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import worker from '../public/_worker.js';

// CPU and subrequest proxy only. This is Node filesystem-backed ASSETS, NOT edge
// CPU billing, Cloudflare asset latency, or a production throughput benchmark.
const dist = join(import.meta.dirname, '..', 'dist');
const manifest = JSON.parse(await readFile(join(dist, 'data/manifest.json')));
let candidate;
for (const [key, file] of Object.entries(manifest.chunks)) {
  const chunk = JSON.parse(await readFile(join(dist, 'data', file)));
  candidate = chunk.nodes.find(node => node.id.startsWith('city.') && !existsSync(join(dist, 'city/box', node.id, 'index.html')))?.id;
  if (candidate) break;
}
assert.ok(candidate, 'a non-prerendered City box exists');
const samples = [];
for (const route of [`/city/box/${candidate}/`, '/city/box/city.nonexistent-audit-id/']) {
  for (let i = 0; i < 11; i++) {
    let subrequests = 0;
    let bytes = 0;
    const env = { ASSETS: { fetch: async request => {
      subrequests++;
      const pathname = new URL(request.url).pathname;
      // The initial static box lookup is a 404; JSON lookups read local files.
      if (!pathname.startsWith('/data/')) return new Response('', { status: 404 });
      const data = await readFile(join(dist, pathname));
      bytes += data.byteLength;
      return new Response(data, { headers: { 'Content-Type': 'application/json' } });
    } } };
    const started = performance.now();
    const response = await worker.fetch(new Request(`https://chicagobudget.com${route}`), env);
    const elapsedMs = performance.now() - started;
    assert.equal(response.status, route.includes('nonexistent') ? 404 : 200);
    if (response.ok) assert.match(await response.text(), /<h1>/);
    samples.push({ route, elapsedMs: Number(elapsedMs.toFixed(2)), subrequests, bytes });
  }
}
console.log(JSON.stringify({ node: process.version, candidate, note: 'First invocation per route may pay cold filesystem cache. Local Node CPU+IO wall time, not edge CPU or paid subrequests.', samples }, null, 2));
