import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { words, count, dollars, oneIn } from './src/lib/format.js';
import { homepageContent, siteMetadata, websiteSchema } from './prerender.js';

/**
 * Fill %TOKENS% in the HTML (title, description, preview text, first-paint numbers) from the data.
 * SITE_URL (optional, e.g. https://example.org) adds canonical and og:url tags and absolute preview images.
 */
function budgetFacts() {
  const values = () => {
    const core = JSON.parse(readFileSync(resolve(__dirname, 'public/data/core.json'), 'utf8'));
    const F = core.facts;
    const site = (process.env.SITE_URL || 'https://chicagobudget.com').replace(/\/$/, '');
    const dataBase = process.env.VITE_DATA_BASE || '/data/';
    if (!dataBase.startsWith('/') || !dataBase.endsWith('/')) throw new Error('VITE_DATA_BASE must be an absolute path ending in /');
    return {
      SITE_URL: site,
      DATA_BASE: dataBase,
      TOTAL_WORDS: words(F.total),
      BOXES: count(core.meta.nodes),
      PROGRAMS: count(core.bubbles.length),
      PER_SECOND: dollars(F.per_second),
      PER_RESIDENT: dollars(F.per_resident),
      ONE_IN_PAST: `One in ${oneIn(F.past_share)}`,
    };
  };
  return {
    name: 'budget-facts',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const v = values();
        const methods = context.path.includes('methods');
        const page = methods ? '/methods' : '/';
        v.SITE_META = siteMetadata(page, v.SITE_URL) + (methods ? '' : '\n' + websiteSchema());
        // Cloudflare Web Analytics does not support custom events. Do not embed
        // another page-view beacon: the site owner may enable one via Pages.
        // Action collection requires both a same-origin endpoint and visitor consent.
        const endpoint = process.env.PUBLIC_ACTION_ANALYTICS_ENDPOINT || '';
        v.ANALYTICS = /^\/[a-z0-9/_-]+$/i.test(endpoint) && !endpoint.startsWith('//')
          ? `<script type="module">import { installActionTracking } from '/src/lib/actionAnalytics.js'; installActionTracking(window, ${JSON.stringify(endpoint)});</script>`
          : '';
        if (!methods) {
          const content = homepageContent(JSON.parse(readFileSync(resolve(__dirname, 'public/data/core.json'), 'utf8')), JSON.parse(readFileSync(resolve(__dirname, 'public/data/sources.json'), 'utf8')));
          v.GOVERNMENTS = content.governments;
          v.PROGRAM_ROWS = content.rows;
          v.RECEIPT_ROWS = content.receipt;
          v.NOTABLE_CARDS = content.cards;
        }
        return html.replace(/%([A-Z_]+)%/g, (m, k) => v[k] ?? m);
      },
    },
  };
}

export default defineConfig({
  plugins: [budgetFacts()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 2048,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        methods: resolve(__dirname, 'methods.html'),
      },
    },
  },
  server: { port: 5179, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4179, strictPort: true, host: '127.0.0.1' },
});
