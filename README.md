# Chicago Budget Explorer

Explore where money goes in the 2026 budgets of the City of Chicago, Chicago Public Schools (CPS), and the Chicago Park District. The project builds a database of nested budget boxes and a website for opening them. Every parent box equals its children to the cent. Planned budgets are not actual spending. Browse the [live explorer](https://chicagobudget.com/), [2026 datasets](https://chicagobudget.com/datasets/), and [source-linked charts and share resources](https://chicagobudget.com/resources/).

| Budget | Official total | Source |
|---|---:|---|
| City | $16,842,553,003 | Passed 2026 ordinance, net total, p. 544 |
| CPS | $10,253,327,463.68 | CPS FY2026 budget |
| Park District | $637,580,350 | 2026 appropriations grand total |

## Discovery operations

After assembling a deployed release with a retained **prior deployed** `discovery-manifest.json`, inspect `site/dist/discovery-changes.json` before IndexNow. The script defaults to a network-free dry run:

```sh
python3 scripts/submit_indexnow.py site/dist/discovery-changes.json
# For a reviewed initial batch, select up to 20 added routes rather than a full resubmission:
python3 scripts/submit_indexnow.py site/dist/discovery-changes.json --include-path /city/ --include-path /datasets/
```

Only after the new release is live, deploy a root `/<key>.txt` file whose public response body is **exactly** the key (no newline), and retain the prior deployed manifest outside the new bundle. With explicit operator approval, run `INDEXNOW_KEY` from a private environment or use `--key-file` outside Git:

```sh
INDEXNOW_KEY="$PRIVATE_INDEXNOW_KEY" python3 scripts/submit_indexnow.py site/dist/discovery-changes.json \
  --previous-manifest /private/prior/discovery-manifest.json --include-path /city/ --submit
```

Submission verifies the prior-to-current delta, public key file, live self-canonical 200 responses for added/changed URLs and genuine 404/410 responses for removals. It rejects stale artifacts, foreign hosts and batches above 10,000 URLs. No CI job submits automatically. A weekly/manual [public smoke workflow](.github/workflows/discovery-monitor.yml) stores a JSON artifact with status, redirect, canonical, robots and user-agent response baselines. For a local measurement:

```sh
python3 scripts/collect_deploy_smoke.py --output /tmp/chicagobudget-discovery-smoke.json
```

Googlebot/Bingbot user-agent requests in that artifact are **simulations**, not verified crawler visits. Keep measurement files and any key material out of the repository.

## Rebuild and check

Use Python 3.11 or newer and SQLite. The [pinned raw inputs](build/inputs.sha256) are published as exact, checksummed copies in [`data/public/2026/sources/raw/`](data/public/2026/sources/raw/). `build/fetch_inputs.sh` restores the missing pinned inputs from that snapshot, so a fresh checkout no longer needs a separate input archive. Do not commit the full exploratory `raw/` directory without reviewing its contents and source terms. Public-source data may include individuals' names; the website omits those names, but that display rule does not redact the underlying public records. To rebuild:

```sh
python3 -m pip install -r requirements.txt
bash build/fetch_inputs.sh
build/build_all.sh
sqlite3 data/budget.db "select id, name, amount_cents / 100.0 from nodes where name like '%Overtime%' limit 10;"
```

The build writes `data/budget.db` and checks totals, sums and website-display privacy. The fetch step also restores the published `data/people/` rosters so the website name-leak scan runs on a fresh checkout. If those rosters are unavailable, that scan is **skipped**, not passed. Never deploy the website without the maintainer's display-name check. Public-source data can retain names even when the website omits them.

Found a wrong number? [Report it](.github/ISSUE_TEMPLATE/number.yml) with the box id and an official source, or read [how to contribute](CONTRIBUTING.md). For a name visible on the website, **do not open a public issue**. Use a private GitHub security advisory.

`build/` and `scripts/` contain builders and processors. `data/splits/` and `research/` contain sourced detail and decisions. The [complete versioned site dataset and unredacted public-source records](data/README.md) are organized by City, CPS, Parks and stable box ID. Public records may contain individual names. The website omits those names, not the underlying source fields. The exploratory `raw/` folder is not copied wholesale into Git. See [licenses and attribution](LICENSES.md): code is MIT and this project's original data work is CC BY 4.0. Upstream publishers retain their own terms.
