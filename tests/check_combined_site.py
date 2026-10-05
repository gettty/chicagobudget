#!/usr/bin/env python3
"""Check that the production Pages bundle retains both explorers without data collisions."""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(dist: Path) -> None:
    for name in ("index.html", "methods.html", "methods/index.html", "city/index.html", "cps/index.html",
                 "parks/index.html", "find/index.html", "box-shell/index.html",
                 "data/sources.json", "data/manifest.json", "visual-data/core.json",
                 "visual-data/tree.json", "visual-data/sources.json", "_redirects"):
        if not (dist / name).is_file():
            raise AssertionError(f"Missing combined Pages asset: {name}")
    home = (dist / "index.html").read_text()
    methods = (dist / "methods.html").read_text()
    if 'href="/visual-data/core.json"' not in home or "Chicago’s 2026 budget" not in home:
        raise AssertionError("The Lakefront homepage or isolated data preload is missing")
    if "How it works" not in methods:
        raise AssertionError("The Lakefront methods page is missing")
    if "style-guide" in home or "style-guide" in methods:
        raise AssertionError("Removed Style guide is linked from Lakefront")
    if sha(dist / "data/sources.json") != sha(ROOT / "site/public/data/sources.json"):
        raise AssertionError("The old budget pages' source index has been replaced")
    if sha(dist / "visual-data/sources.json") != sha(ROOT / "lakefront/public/data/sources.json"):
        raise AssertionError("Lakefront's indexed source data has been replaced")
    core = json.loads((dist / "visual-data/core.json").read_text())
    if core["meta"]["nodes"] != 47360:
        raise AssertionError("Lakefront budget box count changed unexpectedly")
    redirects = (dist / "_redirects").read_text()
    for prefix in ("/city/box/*", "/cps/box/*", "/parks/box/*", "/style-guide"):
        if prefix not in redirects:
            raise AssertionError(f"Missing legacy redirect: {prefix}")
    print("Combined Pages bundle: Lakefront homepage, isolated source indexes, legacy deep pages, and redirects OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path, nargs="?", default=ROOT / "site/dist")
    check(parser.parse_args().dist.resolve())
