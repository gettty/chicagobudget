# Chicago budget explorer site

Static Astro site for the exported budget data in `public/data/`. Build the data with `python3 build/export_site.py` from the repository root, then in this directory run `npm ci`, `npm run check`, and `npm run build`. Astro's current checker needs Node 20.19+ or 22.12+; the project includes a local Node 22 dev dependency for machines with older system Node.

The build writes `dist/` only. It does not deploy. Important box pages are pre-rendered; deep links also use the static `/box-shell/` and Cloudflare Pages `_redirects` rewrites. The rewrite destination must include its trailing slash: `/box-shell` triggers a Pages canonical redirect that loses the original box ID. Keep those rewrites if changing hosts. Test navigation against the deployed Pages preview, since Astro dev does not exercise `_redirects`.

Production combines this site's existing budget pages with the Lakefront homepage. After building `site/`, run `cd ../lakefront && npm ci && npm run data && VITE_DATA_BASE=/visual-data/ SITE_URL=https://chicagobudget.com npm run build`, then from the repository root run `python3 scripts/assemble_production_site.py` and `python3 tests/check_combined_site.py`. Deploy the resulting `site/dist/`. The assembler retains all old routes and `/data/` files, puts the new explorer's data under `/visual-data/`, and replaces only the homepage and shared landing assets. Do not deploy either unassembled `dist/` by itself.

After deployment, run `PREVIEW_URL=https://your-preview.pages.dev node tests/navigation-browser.mjs` with Playwright installed (and `CHROMIUM_PATH` if needed). This follows budget category links, validates destination content, and exercises drill-down and return paths rather than only checking hrefs or generated files.

## Production deployment

The public source is at `https://github.com/gettty/chicagobudget`. Production runs on the Cloudflare Pages project `chicagobudget`, with `chicagobudget.com` as its custom domain. After regenerating the local data export, run `npm ci`, `npm run check`, `npm test`, and `npm run build` here, build Lakefront and assemble as above, then run `npm run deploy` from this directory using an authenticated Wrangler session or a securely provided `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The deployment uploads the assembled `dist/` directly and does not commit exported datasets or generated HTML to Git.

The original pinned budget inputs and built `public/data/` remain untracked at their working paths, but exact source copies and the complete, versioned site dataset are published in [`../data/public/2026/`](../data/public/2026/). From a fresh checkout, `bash build/fetch_inputs.sh` restores the pinned raw inputs and rosters from that snapshot, then the root build creates `public/data/`. GitHub Actions now runs data and site checks using the published sources without an input URL. CI checks never deploy; do not assume automatic Git-based Pages deployment is configured.

## Motion-led design

The production site pairs an editorial paper-and-lake-blue interface with a data-driven boid simulation. Dot counts represent positive budget shares using largest-remainder allocation. All amounts, source links, budget pages, and the deep explorer continue to use the existing data export. Reduced-motion, pause, offscreen suspension, and a no-JavaScript SVG/list fallback are supported.

For production, run `npm run deploy` **only from `main` after checks and build**. `npm run deploy:preview` publishes the `JamesFeedback1` Pages preview and does not update the production custom domain.

Validation: `npm run check` and `npm test`. For real browser checks, run `npx playwright install chromium`, start `npm run dev` in another terminal, then `npm run test:browser`. Set `PREVIEW_URL` to test a deployed preview, `SCREENSHOT_DIR` for captures, or `CHROMIUM_PATH` to reuse an installed Chromium executable. `PLAYWRIGHT_MODULE` optionally selects an existing Playwright module. The browser suite checks data switching, animation/pause/reduced-motion, keyboard access, no-JS fallback, mobile overflow, and the existing deep explorer.

Optional build-time environment variables:

- `PUBLIC_REPO_URL`: an HTTPS GitHub repository URL, such as `https://github.com/owner/repo`. When set, exported, tracked `repo_path` sources without an official URL link to `blob/main/<path>`. Do not configure an unverified repository URL.
- `PUBLIC_CF_ANALYTICS_TOKEN`: Cloudflare Web Analytics site token. The beacon script is emitted only when this is set. It is not configured for local builds.

No per-box JSON download files are created. Box pages show citations and optional repository source links instead.
