#!/usr/bin/env python3
"""Generate discovery files from the final assembled static HTML output.

Usage: python scripts/build_discovery.py site/dist
Only rendered, self-canonical, indexable HTML pages with meaningful visible content
enter the sitemap. No timestamps are inferred from build times.
"""

import argparse
from collections import defaultdict
from datetime import date
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET

ORIGIN = "https://chicagobudget.com"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
ET.register_namespace("", NS)
MAX_ASSETS = 20000
MAX_URLS = 45000
ROOT = Path(__file__).resolve().parents[1]
POLICY_FILE = ROOT / "site/src/lib/route_lifecycle.json"
DATA_FILE = ROOT / "data/public/2026/site/manifest.json"


def policy():
    config = json.loads(POLICY_FILE.read_text(encoding="utf-8"))
    if config["current_budget_year"] != 2026 or config["next_year"]["status"] != "unpublished":
        raise ValueError("Budget year transition requires an explicit reviewed lifecycle update")
    for path, record in config["lastmod"].items():
        if canonical_path(path) != path or not isinstance(record, dict) or not record.get("source"):
            raise ValueError(f"Unverified lastmod provenance: {path}")
        if date.fromisoformat(record["date"]) > date.today():
            raise ValueError(f"Future lastmod: {path}")
    return config


def data_versions(dist):
    """Identify actual inputs, not a single snapshot label for unlike pages."""
    current = dist / "data/manifest.json"
    visual = dist / "visual-data/core.json"
    return {
        "site": json.loads(current.read_text(encoding="utf-8"))["commit"] if current.exists() else None,
        "visual": json.loads(visual.read_text(encoding="utf-8")).get("meta", {}).get("commit") if visual.exists() else None,
        "snapshot": json.loads(DATA_FILE.read_text(encoding="utf-8"))["commit"],
    }


def version_for(route, versions):
    if route.startswith("/datasets/2026/"):
        return "snapshot", versions["snapshot"]
    if route in ("/", "/methods"):
        return "visual", versions["visual"]
    return "site", versions["site"]


def canonical_path(path):
    path = path.split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/") or path.startswith("//"):
        raise ValueError(path)
    if path == "/":
        return path
    if path.rstrip("/") == "/methods":
        return "/methods"
    return path.rstrip("/") + "/"


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals = []
        self.robots = []
        self.title = ""
        self.visible = []
        self.hidden = 0
        self.in_title = False
        self.in_body = False
        self.headings = []
        self.in_heading = False
        self.links = []
        self.descriptions = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and attrs.get("rel", "").lower() == "canonical":
            self.canonicals.append(attrs.get("href", ""))
        if self.in_body and tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if tag == "meta" and attrs.get("name", "").lower() == "description":
            self.descriptions.append(attrs.get("content", ""))
        if tag == "meta" and attrs.get("name", "").lower() == "robots":
            self.robots.append(attrs.get("content", "").lower())
        if tag == "title":
            self.in_title = True
        if tag == "body":
            self.in_body = True
        if self.in_body and tag in ("h1", "h2"):
            self.in_heading = True
        if self.in_body and tag in ("script", "style", "template"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in ("h1", "h2"):
            self.in_heading = False
        if tag in ("script", "style", "template") and self.hidden:
            self.hidden -= 1
        if tag == "body":
            self.in_body = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_heading:
            self.headings.append(data)
        if self.in_body and not self.hidden:
            self.visible.append(data)


def route_for(file, dist):
    relative = file.relative_to(dist).as_posix()
    if relative == "index.html":
        return "/"
    if relative == "methods.html":
        return "/methods"
    if relative.endswith("/index.html"):
        return "/" + relative[:-10]
    return None


def section(path):
    first = path.strip("/").split("/", 1)[0]
    return first if first in ("city", "cps", "parks", "datasets") else "core"


def meaningful_digest(page):
    """Ignore generated asset names, scripts, whitespace and build timestamps."""
    normalized = lambda value: re.sub(r"\s+", " ", value).strip()
    content = [normalized(page.title), *page.canonicals, *map(normalized, page.descriptions),
               normalized(" ".join(page.visible)), *page.links]
    return hashlib.sha256(json.dumps(content, ensure_ascii=False).encode("utf-8")).hexdigest()


def discover(dist, config=None):
    config = config or policy()
    versions = data_versions(dist)
    result = []
    seen = set()
    for file in sorted(dist.rglob("*.html")):
        route = route_for(file, dist)
        if route is None or route.startswith(tuple(config["index_excluded_prefixes"])):
            continue
        if route != canonical_path(route):
            continue
        page = Page()
        content = file.read_bytes()
        page.feed(content.decode("utf-8"))
        url = ORIGIN + route
        if len(page.canonicals) != 1 or page.canonicals[0] != url:
            continue
        if any("noindex" in directive for directive in page.robots):
            continue
        text = " ".join(page.visible).strip()
        # Real headings and financial/source context matter more than length. Small
        # school allocations remain useful even when their descriptions are brief.
        if (not page.title.strip() or not any(h.strip() for h in page.headings)
                or not re.search(r"budget|spending|appropriation|school|dataset|source|method|chicago", text, re.I)
                or re.search(r"opening this box|loading public budget data|box not found", text, re.I)):
            continue
        if url in seen:
            continue
        seen.add(url)
        digest = meaningful_digest(page)
        source, version = version_for(route, versions)
        entry = {"url": url, "path": route, "section": section(route), "title": page.title.strip(),
                 "indexable": True, "renderable": True, "data_source": source, "data_version": version,
                 "content_digest": digest, "version": digest}
        if route in config["lastmod"]:
            entry["lastmod"] = config["lastmod"][route]["date"]
            entry["lastmod_source"] = config["lastmod"][route]["source"]
        result.append(entry)
    return sorted(result, key=lambda item: item["url"])


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def compare(previous, routes):
    """Diff against a retained prior deployment manifest, never a transient build."""
    old = {r["path"]: r for r in previous["routes"]}
    current = {r["path"]: r for r in routes}
    return {"added": [current[p] for p in sorted(current.keys() - old.keys())],
            "changed": [current[p] for p in sorted(current.keys() & old.keys()) if current[p]["version"] != old[p].get("version")],
            "removed": [old[p] for p in sorted(old.keys() - current.keys())]}


def build(dist, previous_manifest=None):
    dist = Path(dist)
    if not dist.is_dir():
        raise FileNotFoundError(dist)
    config = policy()
    routes = discover(dist, config)
    groups = defaultdict(list)
    for route in routes:
        groups[route["section"]].append(route)
    sitemap_files = []
    for group in ("core", "city", "cps", "parks", "datasets"):
        entries = groups[group]
        for offset in range(0, len(entries), MAX_URLS):
            filename = f"sitemap-{group}{'-'+str(offset // MAX_URLS + 1) if len(entries)>MAX_URLS else ''}.xml"
            root = ET.Element(f"{{{NS}}}urlset")
            for entry in entries[offset:offset + MAX_URLS]:
                element = ET.SubElement(root, f"{{{NS}}}url")
                ET.SubElement(element, f"{{{NS}}}loc").text = entry["url"]
                if "lastmod" in entry:
                    ET.SubElement(element, f"{{{NS}}}lastmod").text = entry["lastmod"]
            (dist / filename).write_bytes(xml_bytes(root))
            sitemap_files.append(filename)
    index = ET.Element(f"{{{NS}}}sitemapindex")
    for filename in sitemap_files:
        ET.SubElement(ET.SubElement(index, f"{{{NS}}}sitemap"), f"{{{NS}}}loc").text = ORIGIN + "/" + filename
    (dist / "sitemap-index.xml").write_bytes(xml_bytes(index))
    manifest = {"schema_version": 2, "canonical_origin": ORIGIN, "data_versions": data_versions(dist),
                "lifecycle": config, "quality_rule": "self-canonical indexable rendered HTML with visible content and a title, excluding internal shells", "routes": routes}
    (dist / "discovery-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    if previous_manifest is not None:
        previous = json.loads(Path(previous_manifest).read_text(encoding="utf-8"))
        if previous.get("canonical_origin") != ORIGIN:
            raise ValueError("Previous manifest origin mismatch")
        (dist / "discovery-changes.json").write_text(json.dumps(compare(previous, routes), indent=2, ensure_ascii=False) + "\n")
    guide = ["# Chicago Budget", "", "Independent guide to City of Chicago, Chicago Public Schools, and Chicago Park District budgets. These governments have distinct fiscal periods; totals are not a consolidated City budget.", ""]
    curated = [("/", "Budget overview"), ("/city/", "City of Chicago"), ("/cps/", "Chicago Public Schools"), ("/parks/", "Chicago Park District"), ("/datasets/", "Dataset catalog"), ("/guides/", "Budget guides"), ("/methods", "Methods"), ("/sources/", "Sources")]
    included = {item["path"] for item in routes}
    guide += [f"- [{label}]({ORIGIN}{path})" for path, label in curated if path in included]
    (dist / "llms.txt").write_text("\n".join(guide) + "\n")
    robots = dist / "robots.txt"
    existing = robots.read_text() if robots.exists() else "User-agent: *\nAllow: /\n"
    existing = re.sub(r"(?im)^Sitemap:.*(?:\n|$)", "", existing).rstrip() + "\n\nSitemap: " + ORIGIN + "/sitemap-index.xml\n"
    robots.write_text(existing)
    count = sum(1 for f in dist.rglob("*") if f.is_file())
    if count > MAX_ASSETS:
        raise ValueError(f"Deployment asset cap exceeded: {count} > {MAX_ASSETS}")
    print(f"Discovery: {len(routes)} canonical pages in {len(sitemap_files)} sitemaps; {count} assets")
    return routes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--previous-manifest", type=Path, help="Retained manifest from the prior deployed release")
    args = parser.parse_args()
    build(args.dist, args.previous_manifest)
