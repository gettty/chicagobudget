#!/usr/bin/env python3
"""Validate a deployment delta and optionally notify IndexNow.

Default is a network-free dry run. A real submission requires --submit, a fresh
paired discovery manifest/diff, live canonical/deletion checks, and a publicly
verified key. See https://www.indexnow.org/documentation and /faq.
"""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

ORIGIN = "https://chicagobudget.com"
HOST = "chicagobudget.com"
ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_AGE_HOURS = 24
MAX_BODY = 2_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def fetch(url, method="GET", data=None):
    request = Request(url, data=data, method=method, headers={"User-Agent": "ChicagoBudget-Discovery/1.0", "Content-Type": "application/json; charset=utf-8"} if data else {"User-Agent": "ChicagoBudget-Discovery/1.0"})
    try:
        with build_opener(NoRedirect).open(request, timeout=12) as response:
            return response.status, response.read(MAX_BODY + 1), response.geturl()
    except HTTPError as error:
        return error.code, error.read(MAX_BODY + 1), error.geturl()


class Canonical(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.robots = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and "canonical" in attrs.get("rel", "").lower().split():
            self.links.append(attrs.get("href"))
        if tag == "meta" and attrs.get("name", "").lower() == "robots":
            self.robots.append(attrs.get("content", "").lower())


def valid_url(url):
    if not isinstance(url, str) or len(url) > 2048 or not url.startswith(ORIGIN + "/"):
        raise ValueError("Non-production URL in delta")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != HOST or parsed.query or parsed.fragment or parsed.username or parsed.password or "\\" in url or any(ord(c) < 33 for c in url):
        raise ValueError("Unsafe URL in delta")
    if "//" in parsed.path or "/../" in parsed.path or "/./" in parsed.path or re.search(r"%2f|%5c|%2e|%00", parsed.path, re.I):
        raise ValueError("Ambiguous URL path in delta")
    if parsed.path != "/" and parsed.path != "/methods" and not parsed.path.endswith("/"):
        raise ValueError("Noncanonical path in delta")
    return parsed.path


def load_delta(changes_file, max_age_hours=MAX_AGE_HOURS):
    changes_file = Path(changes_file)
    manifest_file = changes_file.with_name("discovery-manifest.json")
    now = datetime.now(timezone.utc).timestamp()
    for file in (changes_file, manifest_file):
        if not file.is_file() or not 0 <= now - file.stat().st_mtime <= max_age_hours * 3600:
            raise ValueError("Missing or stale discovery artifact")
    if abs(changes_file.stat().st_mtime - manifest_file.stat().st_mtime) > 3600:
        raise ValueError("Discovery artifacts generated at different times")
    changes = json.loads(changes_file.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("canonical_origin") != ORIGIN or manifest.get("schema_version") != 2 or not isinstance(manifest.get("routes"), list):
        raise ValueError("Untrusted discovery manifest")
    if not isinstance(changes, dict) or set(changes) != {"added", "changed", "removed"}:
        raise ValueError("Expected explicit deployment delta, not full sitemap")
    current = {}
    for route in manifest["routes"]:
        path = valid_url(route.get("url"))
        if route.get("path") != path or path in current or not route.get("indexable") or not route.get("renderable"):
            raise ValueError("Invalid current manifest route")
        current[path] = route
    selected = []
    seen = set()
    for kind in ("added", "changed", "removed"):
        if not isinstance(changes[kind], list):
            raise ValueError("Malformed delta")
        for route in changes[kind]:
            path = valid_url(route.get("url"))
            if route.get("path") != path or path in seen or not isinstance(route.get("version"), str):
                raise ValueError("Duplicate or malformed delta route")
            seen.add(path)
            if kind == "removed":
                if path in current:
                    raise ValueError("Removed route still in current manifest")
            elif current.get(path) != route:
                raise ValueError("Delta does not match current manifest")
            selected.append((kind, route["url"]))
    return selected


def validate_live(selected, fetcher=fetch):
    for kind, url in selected:
        status, body, final = fetcher(url)
        if final != url or len(body) > MAX_BODY:
            raise ValueError("Redirect or oversized live response: " + url)
        if kind == "removed":
            if status not in (404, 410):
                raise ValueError("Removed route is not 404/410: " + url)
        else:
            if status != 200:
                raise ValueError("Added/changed route is not 200: " + url)
            page = Canonical()
            page.feed(body.decode("utf-8", errors="replace"))
            if page.links != [url] or any("noindex" in value for value in page.robots):
                raise ValueError("Live canonical/indexability mismatch: " + url)


def read_key(key_file=None):
    if key_file:
        key = Path(key_file).read_text(encoding="ascii")
    else:
        key = os.environ.get("INDEXNOW_KEY", "")
    if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
        raise ValueError("Provide an unpadded valid key via INDEXNOW_KEY or --key-file")
    return key


def verify_key(key, fetcher=fetch):
    location = f"{ORIGIN}/{key}.txt"
    status, body, final = fetcher(location)
    if status != 200 or final != location or body != key.encode("ascii"):
        raise ValueError("Public root key file does not contain exact key bytes")
    return location


def verify_previous(previous_file, changes_file):
    if previous_file is None:
        raise ValueError("--previous-manifest is required for submission to verify the delta")
    previous = json.loads(Path(previous_file).read_text(encoding="utf-8"))
    current = json.loads(Path(changes_file).with_name("discovery-manifest.json").read_text(encoding="utf-8"))
    if previous.get("canonical_origin") != ORIGIN or previous.get("schema_version") != 2 or not isinstance(previous.get("routes"), list) or not previous["routes"]:
        raise ValueError("A retained nonempty production manifest is required")
    old = {}
    for route in previous["routes"]:
        path = valid_url(route.get("url"))
        if route.get("path") != path or path in old or not isinstance(route.get("version"), str):
            raise ValueError("Invalid prior route")
        old[path] = route
    new = {route["path"]: route for route in current["routes"]}
    expected = {"added": [new[p] for p in sorted(new.keys() - old.keys())],
                "changed": [new[p] for p in sorted(new.keys() & old.keys()) if new[p]["version"] != old[p].get("version")],
                "removed": [old[p] for p in sorted(old.keys() - new.keys())]}
    actual = json.loads(Path(changes_file).read_text(encoding="utf-8"))
    if actual != expected:
        raise ValueError("Delta does not match retained prior deployment manifest")


def run(changes_file, submit=False, key_file=None, previous_manifest=None, fetcher=fetch, include_paths=()):
    selected = load_delta(changes_file)
    if include_paths:
        paths = set(include_paths)
        if len(paths) != len(include_paths) or len(paths) > 20 or any(not isinstance(p, str) or not p.startswith("/") or valid_url(ORIGIN + p) != p for p in paths):
            raise ValueError("Choose at most 20 unique canonical --include-path routes")
        added = {url.removeprefix(ORIGIN): url for kind, url in selected if kind == "added"}
        if not paths.issubset(added):
            raise ValueError("--include-path must select only added routes in this delta")
        selected = [(kind, url) for kind, url in selected if kind == "added" and url.removeprefix(ORIGIN) in paths]
    if len(selected) > 10000:
        raise ValueError("More than 10000 changed URLs: split into reviewed subsets")
    print(json.dumps({"mode": "submit" if submit else "dry-run", "counts": {kind: sum(k == kind for k, _ in selected) for kind in ("added", "changed", "removed")}, "urls": [url for _, url in selected]}))
    if not submit or not selected:
        return
    verify_previous(previous_manifest, changes_file)
    key = read_key(key_file)
    location = verify_key(key, fetcher)
    validate_live(selected, fetcher)
    payload = json.dumps({"host": HOST, "key": key, "keyLocation": location, "urlList": [url for _, url in selected]}).encode("utf-8")
    status, _, final = fetcher(ENDPOINT, "POST", payload)
    if final != ENDPOINT or status not in (200, 202):
        raise ValueError(f"IndexNow rejected request (HTTP {status})")
    print(json.dumps({"submitted": len(selected), "http_status": status}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("changes", type=Path, help="Fresh discovery-changes.json alongside discovery-manifest.json")
    parser.add_argument("--submit", action="store_true", help="Explicitly authorize live validation and IndexNow POST")
    parser.add_argument("--key-file", type=Path, help="Private local file holding exact key, with no trailing newline")
    parser.add_argument("--previous-manifest", type=Path, help="Required for --submit: retained prior deployed discovery-manifest.json")
    parser.add_argument("--include-path", action="append", default=[], help="Select up to 20 explicitly reviewed added canonical paths for a bounded initial submission")
    args = parser.parse_args()
    try:
        run(args.changes, args.submit, args.key_file, args.previous_manifest, include_paths=args.include_path)
    except (ValueError, UnicodeError, json.JSONDecodeError) as error:
        print(f"IndexNow aborted: {error}", file=sys.stderr)
        sys.exit(1)
    except OSError:
        print("IndexNow aborted: local file or network operation failed", file=sys.stderr)
        sys.exit(1)
