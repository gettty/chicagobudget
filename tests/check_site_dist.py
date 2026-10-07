#!/usr/bin/env python3
"""Check the built static site before publishing it.

Run after the data export and ``npm run build``. This does not replace the
roster-based privacy check on a machine with the original people files.
"""

from __future__ import annotations

import sys
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.urls: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            value = dict(attrs).get("href")
            if value:
                self.urls.add(value)


def check(dist: Path) -> None:
    assert dist.is_dir(), f"Build directory missing: {dist}"
    files = [p for p in dist.rglob("*") if p.is_file()]
    assert files and len(files) < 19_000, f"Static file budget exceeded: {len(files)}"
    redirects = (dist / "_redirects").read_text()
    assert (dist / "_worker.js").is_file(), "Pages budget HTML worker missing"
    routes = json.loads((dist / "_routes.json").read_text())
    for gov in ("city", "cps", "parks"):
        assert f"/{gov}/box/*" in routes["include"], f"Missing worker route for {gov}"
        assert f"/{gov}/box/* /box-shell/ 200" not in redirects, "A rewrite shadows pre-rendered budget HTML"
    assert (dist / "box-shell" / "index.html").is_file()
    manifest = json.loads((dist / "data/manifest.json").read_text())
    node_roots = {}
    for chunk in set(manifest["chunks"].values()):
        for node in json.loads((dist / "data" / chunk).read_text())["nodes"]:
            node_roots[node["id"]] = "city" if node["root"] == "city-twice" else node["root"]
    forbidden = (b"data/people/", b"raw/", "\u2014".encode())
    links: set[str] = set()
    for path in files:
        assert path.stat().st_size < 25_000_000, f"File over hosting limit: {path}"
        assert len(path.name.encode()) <= 100, f"File name too long: {path}"
        if path.suffix not in (".html", ".json", ".js", ".css"):
            continue
        data = path.read_bytes()
        for needle in forbidden:
            assert needle not in data, f"Forbidden content in {path}"
        if path.suffix == ".html":
            parser = Links()
            parser.feed(data.decode("utf-8"))
            links.update(parser.urls)
    missing = []
    for link in links:
        parts = urlsplit(link)
        if parts.netloc and parts.netloc != "chicagobudget.com":
            continue
        if parts.scheme not in ("", "https", "http") or link.startswith(("#", "mailto:", "tel:")):
            continue
        if not parts.path.startswith("/"):
            continue
        path = unquote(parts.path).rstrip("/")
        if any(path.startswith(f"/{gov}/box/") for gov in ("city", "cps", "parks")):
            _, gov, _, node_id = path.split("/", 3)
            if node_roots.get(node_id) != gov:
                missing.append(path)
            continue  # Valid IDs are rendered by the scoped Pages worker.
        target = dist / path.lstrip("/")
        if not (target.is_file() or (target / "index.html").is_file()):
            missing.append(path)
    assert not missing, f"Broken internal links: {sorted(set(missing))[:20]}"
    print(f"Checked {len(files)} static files and {len(links)} distinct links")


if __name__ == "__main__":
    check(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("site/dist"))
