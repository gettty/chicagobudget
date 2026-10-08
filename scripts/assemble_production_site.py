#!/usr/bin/env python3
"""Assemble the Lakefront homepage with the existing Astro budget pages for Pages.

Run after both site and lakefront builds. The old /data/ tree belongs to Astro;
Lakefront is built with VITE_DATA_BASE=/visual-data/ to avoid replacing its
sources.json (the two files have different schemas).
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assemble(site: Path, lakefront: Path, previous_manifest: Path | None = None,
             indexnow_key_file: Path | None = None) -> None:
    key = None
    if indexnow_key_file:
        key = indexnow_key_file.read_text(encoding="utf-8").strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
            raise ValueError("Invalid IndexNow verification key format")
    if previous_manifest and not previous_manifest.is_file():
        raise FileNotFoundError("Prior deployment manifest not found")
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
    for target in ("assets", "visual-data"):
        if (site / target).exists():
            raise FileExistsError(f"Rebuild the Astro output before assembling: {site / target}")
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
    if key:
        (site / f"{key}.txt").write_text(key, encoding="utf-8")
    # Derive runtime-only data from this exact privacy-safe export, never from
    # the unredacted research inputs. Generate routing from actual built HTML.
    subprocess.run([sys.executable, str(ROOT / "scripts/build_fallback_data.py"),
                    "--data-dir", str(site / "data")], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build_static_routes.py"),
                    str(site)], check=True)
    discovery = [sys.executable, str(ROOT / "scripts/build_discovery.py"), str(site)]
    if previous_manifest:
        discovery += ["--previous-manifest", str(previous_manifest)]
    subprocess.run(discovery, check=True)
    print(f"Assembled Lakefront homepage, {len(list((site / 'visual-data').rglob('*.json')))} visual data files, and existing Astro routes in {site}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=ROOT / "site/dist")
    parser.add_argument("--lakefront-dir", type=Path, default=ROOT / "lakefront/dist")
    parser.add_argument("--previous-manifest", type=Path, help="Retained previous deployed discovery manifest")
    parser.add_argument("--indexnow-key-file", type=Path, help="Private local key file to publish for IndexNow ownership verification")
    args = parser.parse_args()
    assemble(args.site_dir.resolve(), args.lakefront_dir.resolve(), args.previous_manifest, args.indexnow_key_file)
