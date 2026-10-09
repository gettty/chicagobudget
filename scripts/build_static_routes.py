#!/usr/bin/env python3
"""Exclude only proven static budget box URLs from Pages Function routing.

Run on the assembled site/dist after all static pages have been copied. An exact
rule for each trailing-slash variant is intentional: a wildcard could suppress
404/dynamic fallback for box IDs that were never exported.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

MAX_RULES = 100
MAX_RULE_LENGTH = 100
BOX_SECTIONS = ("city", "cps", "parks")


def build_routes(dist: Path) -> dict:
    """Replace dist/_routes.json exclusions with bounded, verified static URLs."""
    dist = Path(dist)
    routes_file = dist / "_routes.json"
    routes = json.loads(routes_file.read_text(encoding="utf-8"))
    includes = routes["include"]
    if (not isinstance(includes, list) or
            any(not isinstance(rule, str) or len(rule.encode("utf-8")) > MAX_RULE_LENGTH for rule in includes) or
            len(includes) > MAX_RULES):
        raise ValueError("Invalid Pages include rules")

    candidates = []
    for section in BOX_SECTIONS:
        box_dir = dist / section / "box"
        if not box_dir.is_dir():
            continue
        for page in box_dir.glob("*/index.html"):
            if not page.is_file() or page.is_symlink() or page.parent.is_symlink():
                continue
            box_id = page.parent.name
            if (not box_id.isascii() or box_id in (".", "..") or
                    any(char in box_id for char in "*?#[%/")):
                continue
            url = f"/{section}/box/{box_id}"
            if len(url + "/") > MAX_RULE_LENGTH:
                continue
            # Shallow category/agency boxes are stable, useful landing pages.
            candidates.append((box_id.count("."), len(url), url))

    candidates.sort()
    capacity = (MAX_RULES - len(includes)) // 2
    excludes = [variant for _, _, url in candidates[:capacity]
                for variant in (url, url + "/")]
    routes["exclude"] = excludes
    # Do not touch the destination until all validation and serialization succeed.
    payload = json.dumps(routes, separators=(",", ":"), ensure_ascii=False) + "\n"
    fd, temporary = tempfile.mkstemp(prefix="._routes-", suffix=".json", dir=dist)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(payload)
        os.replace(temporary, routes_file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return routes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist", nargs="?", type=Path, default=Path("site/dist"))
    args = parser.parse_args()
    routes = build_routes(args.dist)
    print(f"{len(routes['exclude'])} exact static exclusions; "
          f"{len(routes['include']) + len(routes['exclude'])} total rules")


if __name__ == "__main__":
    main()
