import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homepageContent, siteMetadata, websiteSchema, escapeHtml } from '../prerender.js';
import { exact } from '../src/lib/format.js';

const core = JSON.parse(readFileSync(new URL('../public/data/core.json', import.meta.url)));
const sources = JSON.parse(readFileSync(new URL('../public/data/sources.json', import.meta.url)));

test('the prerender uses each official government amount and all real programs', () => {
  const html = homepageContent(core, sources);
  for (const gov of core.govs) {
    assert.match(html.governments, new RegExp(`href="/${gov.id}/"`));
    assert.ok(html.governments.includes(exact(gov.amount)));
  }
  assert.equal((html.rows.match(/<tr>/g) || []).length, core.bubbles.length);
  assert.ok(html.rows.includes(exact(core.bubbles[0].amount)));
  assert.equal((html.cards.match(/<article /g) || []).length, 6);
  assert.equal((html.cards.match(/Source and records/g) || []).length, 6);
  assert.ok(html.governments.includes('not an official consolidated budget'));
  assert.ok(html.cards.includes('Payments to individuals are pooled and not shown'));
  assert.ok(html.cards.includes(sources.find((s) => s.dataset === '6694-f78c').url.replace(/&/g, '&amp;')));
  assert.ok(html.cards.includes(sources.find((s) => s.doc === 'CPS FY2026 Budget Book').url));
});

test('source-derived strings are escaped, including attribute delimiters', () => {
  assert.equal(escapeHtml(`<a title="x&y">'`), '&lt;a title=&quot;x&amp;y&quot;&gt;&#39;');
  const changed = structuredClone(core);
  changed.bubbles[0].name = '<img src=x onerror="alert(1)">';
  const { rows } = homepageContent(changed);
  assert.ok(rows.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!rows.includes('<img'));
});

test('canonical and social metadata are distinct and WebSite schema claims no author', () => {
  assert.match(siteMetadata('/'), /rel="canonical" href="https:\/\/chicagobudget.com\/"/);
  assert.match(siteMetadata('/methods'), /rel="canonical" href="https:\/\/chicagobudget.com\/methods"/);
  assert.match(siteMetadata('/methods'), /twitter:image/);
  assert.match(siteMetadata('/methods'), /og:description/);
  assert.doesNotMatch(siteMetadata('/methods'), /href="https:\/\/chicagobudget.com\/"/);
  const data = JSON.parse(websiteSchema().replace(/^<script[^>]*>|<\/script>$/g, ''));
  assert.equal(data['@type'], 'WebSite');
  assert.equal(data.author, undefined);
});

test('built homepage and methods preserve canonical and rendered data', () => {
  const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const methods = readFileSync(new URL('../dist/methods.html', import.meta.url), 'utf8');
  assert.ok(home.includes(exact(core.govs[0].amount)));
  assert.ok(home.includes(exact(core.govs[1].amount)));
  assert.ok(home.includes(exact(core.govs[2].amount)));
  assert.ok(home.includes(`href="/city/box/${core.bubbles.find((b) => b.gov === 'city').id}/"`));
  assert.ok(home.includes('id="tableBody"><tr>'));
  assert.ok(home.includes('id="stories"><article'));
  assert.ok(!home.includes('id="rtotal">$0'));
  assert.ok(!home.includes('%SITE_META%'));
  assert.match(home, /rel="canonical" href="https:\/\/chicagobudget.com\/"/);
  assert.match(methods, /rel="canonical" href="https:\/\/chicagobudget.com\/methods"/);
});
