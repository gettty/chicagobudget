# Chicago budget explorer site

Static Astro site for the exported budget data in `public/data/`. Build the data with `python3 build/export_site.py` from the repository root, then in this directory run `npm ci`, `npm run check`, and `npm run build`. Astro's current checker needs Node 20.19+ or 22.12+; the project includes a local Node 22 dev dependency for machines with older system Node.

The build writes `dist/` only. It does not deploy. Important box pages are pre-rendered. A scoped Cloudflare Pages advanced-mode worker serves those static files first and renders other valid budget IDs as complete HTML from the exported data. Unknown IDs return 404 and temporary data failures return 503. Do not restore blanket `/box-shell/` rewrites, which override real static pages. Test the assembled bundle with `npx wrangler pages dev dist`, since Astro dev does not exercise the Pages worker.

Production combines this site's existing budget pages with the Lakefront homepage. After building `site/`, run `cd ../lakefront && npm ci && npm run data && VITE_DATA_BASE=/visual-data/ SITE_URL=https://chicagobudget.com npm run build`, then from the repository root run `python3 scripts/assemble_production_site.py` and `python3 tests/check_combined_site.py`. Deploy the resulting `site/dist/`. The assembler retains all old routes and `/data/` files, puts the new explorer's data under `/visual-data/`, and replaces only the homepage and shared landing assets. Do not deploy either unassembled `dist/` by itself.

### Budget fallback performance

Assembly generates `data/fallback/` from the same privacy-safe `/data/` export. Its 1,024 deterministic hash buckets contain only the fields needed to render each box, its children, breadcrumbs, and citations. A dynamic request reads one bounded bucket instead of parsing the full source catalog, spine, and multiple owner chunks. Every bucket exists, including empty buckets, so an unknown ID returns 404 while missing or invalid data returns retryable 503. No cross-request response cache is used, avoiding stale deployment data and shared request-body state. The public research snapshot is not modified or redacted by this step.

`npm test` regenerates the local fallback data automatically. The assembler regenerates it again from the final `dist/data` export and enforces the existing 20,000-asset budget through the discovery checker. Do not copy fallback shards from a different build.

Assembly also derives exact static-box exclusions in `_routes.json` from actual HTML files. It selects up to 48 shallow, short box paths, covering both slash variants within Pages' 100-rule and 100-character limits. This is deliberately a limited routing improvement, not a claim that all static boxes bypass Functions. No wildcard exclusions, crawler restrictions, or changes to `/_events` are added. The HTTP acceptance suite checks both static exclusions and dynamic descendants.

Run `python3 -m unittest discover -s tests -p 'test_fallback_data.py'` and `python3 -m unittest discover -s tests -p 'test_static_routes.py'` from the repository root. The local comparison harness in `site/checks/fallback-performance.mjs` measures source-data reads and verifies HTML parity against a supplied baseline worker. Its Node measurements are not Cloudflare CPU measurements or a billing forecast. Hosted performance and cost must be rechecked after a separately approved deployment. Opening a PR or passing CI does not authorize a merge or deployment.

After deployment, run `PREVIEW_URL=https://your-preview.pages.dev node tests/navigation-browser.mjs` with Playwright installed (and `CHROMIUM_PATH` if needed). This follows budget category links, validates destination content, and exercises drill-down and return paths rather than only checking hrefs or generated files.

## Search and dataset discovery

Assembly runs `scripts/build_discovery.py` after both sites are combined. It generates segmented sitemaps and a sitemap index from rendered, self-canonical HTML, plus `discovery-manifest.json` and a small `llms.txt` navigation aid. It does not invent modification dates or change AI-training permissions. Canonical URLs use `https://chicagobudget.com`, with `/methods` as the slash-free exception. Dataset catalog and guide pages link to the versioned public snapshot and explain fiscal-period and double-counting limitations.

Validation includes `python3 -m unittest discover -s tests -p 'test_discovery.py'` from the repository root and both combined-output checkers. With Pages dev running on port 4182, run `python3 tests/check_pages_http.py http://127.0.0.1:4182 --dist site/dist` from the root, then `PREVIEW_URL=http://127.0.0.1:4182 node tests/seo-browser.mjs` from `site/` after installing Playwright Chromium. These checks exercise actual worker responses and JavaScript-enabled and disabled discovery.

Search Console and Bing ownership verification, sitemap submission, production alias redirects, and any crawl-policy or analytics account configuration require separately authorized account access. No credentials or automatic URL-submission jobs are included. `llms.txt` and structured metadata do not guarantee rankings or AI citations.

## Production deployment

The public source is at `https://github.com/gettty/chicagobudget`. Production runs on the Cloudflare Pages project `chicagobudget`, with `chicagobudget.com` as its custom domain. After regenerating the local data export, run `npm ci`, `npm run check`, `npm test`, and `npm run build` here, build Lakefront and assemble as above, then run `npm run deploy` from this directory using an authenticated Wrangler session or a securely provided `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The deployment uploads the assembled `dist/` directly and does not commit exported datasets or generated HTML to Git.

The original pinned budget inputs and built `public/data/` remain untracked at their working paths, but exact source copies and the complete, versioned site dataset are published in [`../data/public/2026/`](../data/public/2026/). From a fresh checkout, `bash build/fetch_inputs.sh` restores the pinned raw inputs and rosters from that snapshot, then the root build creates `public/data/`. GitHub Actions now runs data and site checks using the published sources without an input URL. CI checks never deploy; do not assume automatic Git-based Pages deployment is configured.

## Motion-led design

The production site pairs an editorial paper-and-lake-blue interface with a data-driven boid simulation. Dot counts represent positive budget shares using largest-remainder allocation. All amounts, source links, budget pages, and the deep explorer continue to use the existing data export. Reduced-motion, pause, offscreen suspension, and a no-JavaScript SVG/list fallback are supported.

For production, run `npm run deploy` **only from `main` after checks and build**. `npm run deploy:preview` publishes the `JamesFeedback1` Pages preview and does not update the production custom domain.

Validation: `npm run check` and `npm test`. For real browser checks, run `npx playwright install chromium`, start `npm run dev` in another terminal, then `npm run test:browser`. Set `PREVIEW_URL` to test a deployed preview, `SCREENSHOT_DIR` for captures, or `CHROMIUM_PATH` to reuse an installed Chromium executable. `PLAYWRIGHT_MODULE` optionally selects an existing Playwright module. The browser suite checks data switching, animation/pause/reduced-motion, keyboard access, no-JS fallback, mobile overflow, and the existing deep explorer.

Optional build-time environment variables:

- `PUBLIC_REPO_URL`: an HTTPS GitHub repository URL, such as `https://github.com/owner/repo`. When set, exported, tracked `repo_path` sources without an official URL link to `blob/main/<path>`. Do not configure an unverified repository URL.
- `PUBLIC_ACTION_ANALYTICS_ENDPOINT=/_events`: enables the optional action-count controls in both Astro and Lakefront builds. Counts remain off for each visitor until explicit consent. DNT/GPC suppress counting. The deployed worker also requires `ACTION_ANALYTICS_ENABLED=true` and the `ACTION_COUNTS` D1 binding.
- Page-view analytics uses the existing Cloudflare zone-level automatic Web Analytics installation. Do not inject a second manual beacon.

## Optional aggregate action counts

`wrangler.jsonc` keeps production and preview D1 databases separate. Apply `migrations/0001_action_counts.sql` before enabling the endpoint. The production zone has an endpoint-only `/_events` edge rule limiting requests to 10 per 10 seconds per IP/Cloudflare location, with a 10-second block. Verify that protection before enabling writes, and set `ACTION_ANALYTICS_ENABLED=false` to disable them. It mitigates bursts, not distributed abuse or synthetic counts. Previews require the explicit preview flag and a non-main Pages branch. Local development is disabled by default.

The database stores daily totals by four allowlisted action types and budget group, not individual event records, names, URLs, searches, IPs or user identifiers. These are consented action counts, not unique visitors or verified humans. Cloudflare still processes transport metadata. Do not enable request-body logging. Purge old aggregates with `DELETE FROM action_counts WHERE day < date('now', '-90 days')`; maintenance is scheduled weekly outside GitHub and must be monitored. This is not a guarantee of exact 90-day deletion if maintenance cannot run.

For IndexNow release assembly, use `--indexnow-key-file /private/key` and, when available, `--previous-manifest /private/previous-deployment/discovery-manifest.json`. Retain the newly deployed manifest outside a fresh build for the next release. The first rollout uses a clearly scoped live baseline and submits only new paths independently verified to have returned 404 before deployment, not the entire legacy inventory.

No per-box JSON download files are created. Box pages show citations and optional repository source links instead.
