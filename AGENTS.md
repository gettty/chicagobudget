# Repository review guidance

## Code Review Rules

- Preserve exact cent-based reconciliation and distinguish appropriations, actual payments, estimates, residuals and counted-twice transfers. Require source evidence for new financial claims or splits, and retain fiscal periods and caveats.
- Keep individuals' names out of rendered website pages and website data exports. The public-source research snapshot in `data/public/2026/sources/` is intentionally unredacted. Do not flag that policy as a defect or silently redact the published research data.
- Preserve existing budget deep links, citations, canonical URLs, preview noindex, and usable no-JavaScript HTML. Unknown IDs must return 404, while temporary data failures must remain retryable 503. Routing exclusions must not disable valid dynamic pages.
- Keep runtime data reads and memory bounded, preserve the static asset/routing limits enforced by tests, and isolate production from preview analytics. Do not share request-scoped I/O across requests or weaken consent/privacy safeguards.
- Reviews are advisory. Do not merge, deploy, change account settings, or bypass CI or owner approval. Focus findings on concrete, reproducible correctness, security, data-integrity and performance regressions rather than style preferences.
