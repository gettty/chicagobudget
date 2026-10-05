import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { words, count, dollars, oneIn } from './src/lib/format.js';

/**
 * Fill %TOKENS% in the HTML (title, description, preview text, first-paint numbers) from the data.
 * SITE_URL (optional, e.g. https://example.org) adds canonical and og:url tags and absolute preview images.
 */
function budgetFacts() {
  const values = () => {
    const core = JSON.parse(readFileSync(resolve(__dirname, 'public/data/core.json'), 'utf8'));
    const F = core.facts;
    const site = (process.env.SITE_URL || '').replace(/\/$/, '');
    return {
      SITE_URL: site,
      SITE_META: site ? `<meta property="og:url" content="${site}/">\n<link rel="canonical" href="${site}/">` : '',
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
      handler(html) {
        const v = values();
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
