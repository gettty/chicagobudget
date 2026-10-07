# Chicago Budget Explorer

Explore where money goes in the 2026 budgets of the City of Chicago, Chicago Public Schools (CPS), and the Chicago Park District. The project builds a database of nested budget boxes and a website for opening them. Every parent box equals its children to the cent. Planned budgets are not actual spending. Browse the [live explorer](https://chicagobudget.com/), [2026 datasets](https://chicagobudget.com/datasets/), and [source-linked charts and share resources](https://chicagobudget.com/resources/).

| Budget | Official total | Source |
|---|---:|---|
| City | $16,842,553,003 | Passed 2026 ordinance, net total, p. 544 |
| CPS | $10,253,327,463.68 | CPS FY2026 budget |
| Park District | $637,580,350 | 2026 appropriations grand total |

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
