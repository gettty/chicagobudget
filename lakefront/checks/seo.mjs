import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exact } from '../src/lib/format.js';

const core = JSON.parse(readFileSync(new URL('../public/data/core.json', import.meta.url)));
test('built homepage and methods preserve canonical and rendered data', () => {
  const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const methods = readFileSync(new URL('../dist/methods.html', import.meta.url), 'utf8');
  for (const gov of core.govs) assert.ok(home.includes(exact(gov.amount)));
  assert.ok(home.includes(`href="/city/box/${core.bubbles.find((b) => b.gov === 'city').id}/"`));
  assert.ok(home.includes('id="tableBody"><tr>'));
  assert.ok(home.includes('id="stories"><article'));
  assert.ok(!home.includes('id="rtotal">$0'));
  assert.ok(!home.includes('%SITE_META%'));
  assert.match(home, /rel="canonical" href="https:\/\/chicagobudget.com\/"/);
  assert.match(methods, /rel="canonical" href="https:\/\/chicagobudget.com\/methods"/);
});
