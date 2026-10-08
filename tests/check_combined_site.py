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
                 "visual-data/tree.json", "visual-data/sources.json", "_redirects", "_worker.js", "_routes.json",
                 "sitemap-index.xml", "discovery-manifest.json", "robots.txt", "llms.txt",
                 "datasets/index.html", "guides/index.html"):
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
    if "/box-shell/ 200" in redirects:
        raise AssertionError("Budget rewrites must not shadow pre-rendered HTML")
    for rule in ("/style-guide / 301", "/style-guide/ / 301", "/methods/ /methods 301"):
        if rule not in redirects:
            raise AssertionError(f"Missing canonical redirect: {rule}")
    routes = json.loads((dist / "_routes.json").read_text())
    rules = routes["include"] + routes["exclude"]
    if len(rules) > 100 or any(len(rule.encode("utf-8")) > 100 for rule in rules):
        raise AssertionError("Pages invocation routing exceeds supported limits")
    if "/_events" not in routes["include"]:
        raise AssertionError("Action endpoint must remain worker-routed")
    for route in routes["exclude"]:
        if not any(route.startswith(f"/{gov}/box/") for gov in ("city", "cps", "parks")) or any(char in route for char in "*?#[%"):
            raise AssertionError(f"Unsafe static exclusion: {route}")
        if not (dist / route.strip("/") / "index.html").is_file():
            raise AssertionError(f"Static exclusion has no matching HTML: {route}")
    fallback = dist / "data/fallback"
    expected_shards = {f"{index:03x}.json" for index in range(1024)}
    if {path.name for path in fallback.iterdir()} != expected_shards:
        raise AssertionError("Fallback must contain all 1024 direct-addressed shards")
    for path in fallback.iterdir():
        if path.stat().st_size > 512 * 1024:
            raise AssertionError(f"Fallback shard is unbounded: {path.name}")
        payload = json.loads(path.read_text())
        if payload.get("version") != 1 or not isinstance(payload.get("records"), dict):
            raise AssertionError(f"Invalid fallback shard: {path.name}")
    for gov in ("city", "cps", "parks"):
        if f"/{gov}/box/*" not in routes["include"]:
            raise AssertionError(f"Missing server-rendered fallback for {gov}")
        if f'href="/{gov}/"' not in home:
            raise AssertionError(f"Homepage lacks a crawlable {gov} link")
    if 'href="https://chicagobudget.com/methods"' not in methods:
        raise AssertionError("Methods canonical is missing")
    if "Sitemap: https://chicagobudget.com/sitemap-index.xml" not in (dist / "robots.txt").read_text():
        raise AssertionError("Sitemap discovery is missing from robots.txt")
    print("Combined Pages bundle: real HTML routes, isolated data, canonicals and sitemap OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path, nargs="?", default=ROOT / "site/dist")
    check(parser.parse_args().dist.resolve())
