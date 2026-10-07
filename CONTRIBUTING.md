# Contributing

Thank you for helping. This project explains the 2026 budgets of the City of Chicago, Chicago Public Schools and the Chicago Park District in plain language. Fixes to numbers, sources, wording and code are all welcome.

Data contributions fix numbers, add detail or improve explanations. Site contributions improve code, writing or accessibility. Add data detail in `data/splits/<gov>/`, not by changing a builder; read `build/SPLITS.md`. Site code lives in `site/` and must pass the site checks.

## Local setup and a split example

Use Python 3.11+, SQLite and Node 22+ for site work. The [2026 public snapshot](data/README.md) contains the pinned raw inputs and roster records; `build/fetch_inputs.sh` checks their hashes and restores them to ignored working paths. A fresh checkout needs no private archive. Never add the entire local `raw/` or `data/people/` directory to a PR. Source records can include names, but website-facing fields must not.

In a shallow clone, the site snapshot-provenance test needs the pinned publication commit object to compare the published files. Before `cd site && npm test`, fetch just that commit: `git fetch --no-tags --depth=1 origin "$(node -p "require('./site/src/lib/route_lifecycle.json').snapshot_publication_revision")"`. Site CI performs this targeted fetch automatically.

For your first change:

```sh
python3 -m pip install -r requirements.txt
bash build/fetch_inputs.sh
build/build_all.sh
# For a website change, after the data build:
cd site && npm ci && npm run check && npm test && npm run build
cd .. && python3 tests/check_site_dist.py site/dist
```

Start with a small sourced correction in `data/splits/<gov>/` or a focused change in `site/`. The generated `data/budget.db`, `site/public/data/`, and `site/dist/` are ignored working files. Do not force-add them or the exploratory raw cache. Only update the versioned `data/public/2026/` release when intentionally publishing a new checked dataset, then run `python3 scripts/publish_site_dataset.py` and `python3 tests/check_public_dataset.py` after the site build. Check `git status` and your staged diff before opening a PR.

Find a box with `sqlite3 data/budget.db "select id, amount_cents from nodes where name like '%Overtime%' limit 10;"`. A split file targets one existing box and names its exact expected dollar amount:

```json
{
  "meta": {"author": "your name", "description": "Documented overtime breakdown"},
  "splits": [{
    "target": {"by": "id", "id": "replace-with-real-box-id"},
    "expect_amount": 12000000,
    "pieces": [{"name": "Documented portion", "amount": 3000000, "basis": "tied",
      "source": {"doc": "Public budget document", "url": "https://example.org/budget", "page": 12}}],
    "residual": {"name": "Other overtime not itemised", "why": "The public document does not break this part down further."}
  }]
}
```

Replace the example id, figures and URL with real public evidence. Amounts are dollars, with cents allowed. A City ordinance line may be targeted by fund, department, authority and account instead. Every piece needs a public source URL (and page where applicable). Add a `why` sentence to an unsplit piece of $10M or more. Pieces cannot exceed the target; the remainder becomes a visible residual. Mismatched expected amounts and invalid splits are logged and skipped, never forced. Use one file per topic.

Run `build/build_all.sh`: the builders check exact parent sums and official root totals, basis and source, explanations for large leaves, unique sibling names, finite amounts and website-display privacy. `build/verify_db.py` and `build/validate_site_data.py` run as part of that build. For site changes, also run the Node checks above. CI rebuilds the public inputs and tests both data and site changes; no CI workflow deploys the site.

## Ground rules

- Every number needs a public source. Never guess a number. If something is our estimate, it must be labeled as an estimate.
- Write in plain language a 13-year-old can follow.
- Do not add individuals' names to anything the website shows. This is a presentation rule, not a rule to redact name fields from public-source datasets.
- Report problems as GitHub issues.
- Use only public documents and datasets with URLs. Do not scale a number to fit. Prefer official figures; label an estimate `proxy` and explain its method.
- Never put an individual's name in a box label, note, explanation or side label. Business names are okay. Public source files may contain public-record names, but the site hides individuals.
- Keep site numbers generated from data, not hand-typed in components. Use plain language and avoid em dashes.

## Review and sensitive reports

A maintainer reviews each pull request and checks at least one changed data piece against its source. Include changed box IDs, source links and local test results in the PR template. The website name-leak check uses the published rosters restored by the fetch step and runs in CI; the maintainer also checks the actual deployed site before release. Merge does not deploy. If a person's name appears on the website, report it privately through a [GitHub security advisory](https://github.com/gettty/chicagobudget/security/advisories/new), not a public issue. The maintainer aims to fix confirmed exposure within a day.

## Contributor agreement

By sending a contribution to this repository (a pull request, a commit, an issue with text or data meant to be included, or any other material), you agree that:

1. You wrote it yourself or have the right to submit it, and it does not copy anyone else's work in a way that breaks their terms.
2. Code you contribute is licensed under the MIT License (`LICENSE`), and data and writing you contribute are licensed under CC BY 4.0 (`LICENSE-DATA`), the same as the rest of the project.
3. You also grant Getty Hill, the project owner, a permanent, worldwide, free, non-exclusive right to use, change, and relicense your contribution as part of this project, including under different license terms in the future.
4. You keep the copyright in your own contribution. This agreement only gives the permissions above.

If you do not agree, please do not send the contribution.
