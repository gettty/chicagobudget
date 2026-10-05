#!/usr/bin/env python3
"""Assemble the Lakefront homepage with the existing Astro budget pages for Pages.

Run after both site and lakefront builds. The old /data/ tree belongs to Astro;
Lakefront is built with VITE_DATA_BASE=/visual-data/ to avoid replacing its
sources.json (the two files have different schemas).
"""

import argparse
import hashlib
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assemble(site: Path, lakefront: Path) -> None:
    for path in (site / "index.html", site / "data/sources.json", site / "_redirects",
                 lakefront / "index.html", lakefront / "methods.html", lakefront / "data/sources.json",
                 lakefront / "data/core.json", lakefront / "assets"):
        if not path.exists():
            raise FileNotFoundError(f"Build output missing: {path}")
    html = (lakefront / "index.html").read_text()
    if 'href="/visual-data/core.json"' not in html:
        raise ValueError("Lakefront must be built with VITE_DATA_BASE=/visual-data/")
    if not any(b"visual-data/" in asset.read_bytes() for asset in (lakefront / "assets").glob("*.js")):
        raise ValueError("Lakefront JavaScript must fetch from /visual-data/")
    legacy_sources = digest(site / "data/sources.json")
    for name in ("index.html", "methods.html", "404.html", "favicon.svg", "og.jpg", "robots.txt"):
        source = lakefront / name
        if source.is_file():
            shutil.copy2(source, site / name)
    (site / "methods").mkdir(exist_ok=True)
    shutil.copy2(lakefront / "methods.html", site / "methods/index.html")
    for dirname, target in (("assets", "assets"), ("data", "visual-data")):
        destination = site / target
        if destination.exists():
            raise FileExistsError(f"Rebuild the Astro output before assembling: {destination}")
        shutil.copytree(lakefront / dirname, destination)
    if digest(site / "data/sources.json") != legacy_sources:
        raise ValueError("Legacy source index was unexpectedly changed")
    print(f"Assembled Lakefront homepage, {len(list((site / 'visual-data').rglob('*.json')))} visual data files, and existing Astro routes in {site}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=ROOT / "site/dist")
    parser.add_argument("--lakefront-dir", type=Path, default=ROOT / "lakefront/dist")
    args = parser.parse_args()
    assemble(args.site_dir.resolve(), args.lakefront_dir.resolve())
