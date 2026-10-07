#!/usr/bin/env python3
"""Generate discovery files from the final assembled static HTML output.

Usage: python scripts/build_discovery.py site/dist
Only rendered, self-canonical, indexable HTML pages with meaningful visible content
enter the sitemap. No timestamps are inferred from build times.
"""

import argparse
from collections import defaultdict
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

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and attrs.get("rel", "").lower() == "canonical":
            self.canonicals.append(attrs.get("href", ""))
        if tag == "meta" and attrs.get("name", "").lower() == "robots":
            self.robots.append(attrs.get("content", "").lower())
        if tag == "title":
            self.in_title = True
        if tag == "body":
            self.in_body = True
        if self.in_body and tag in ("script", "style", "template"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in ("script", "style", "template") and self.hidden:
            self.hidden -= 1
        if tag == "body":
            self.in_body = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
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


def discover(dist):
    result = []
    seen = set()
    for file in sorted(dist.rglob("*.html")):
        route = route_for(file, dist)
        if route is None or route.startswith(("/find/", "/box-shell/", "/404/")):
            continue
        if route != canonical_path(route):
            continue
        page = Page()
        page.feed(file.read_text(encoding="utf-8"))
        url = ORIGIN + route
        if len(page.canonicals) != 1 or page.canonicals[0] != url:
            continue
        if any("noindex" in directive for directive in page.robots):
            continue
        text = " ".join(page.visible).strip()
        # A useful landing page must contain more than an app-loading shell.
        if len(re.sub(r"\s+", " ", text)) < 100 or re.search(r"opening this box|loading public budget data|box not found", text, re.I):
            continue
        if url in seen:
            continue
        seen.add(url)
        result.append({"url": url, "path": route, "section": section(route), "title": page.title.strip()})
    return sorted(result, key=lambda item: item["url"])


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def build(dist):
    dist = Path(dist)
    if not dist.is_dir():
        raise FileNotFoundError(dist)
    routes = discover(dist)
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
                ET.SubElement(ET.SubElement(root, f"{{{NS}}}url"), f"{{{NS}}}loc").text = entry["url"]
            (dist / filename).write_bytes(xml_bytes(root))
            sitemap_files.append(filename)
    index = ET.Element(f"{{{NS}}}sitemapindex")
    for filename in sitemap_files:
        ET.SubElement(ET.SubElement(index, f"{{{NS}}}sitemap"), f"{{{NS}}}loc").text = ORIGIN + "/" + filename
    (dist / "sitemap-index.xml").write_bytes(xml_bytes(index))
    (dist / "discovery-manifest.json").write_text(json.dumps({"canonical_origin": ORIGIN, "quality_rule": "self-canonical indexable static HTML with at least 100 visible characters, excluding internal shells", "routes": routes}, indent=2, ensure_ascii=False) + "\n")
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
    build(parser.parse_args().dist)
