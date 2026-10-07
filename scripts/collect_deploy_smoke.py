#!/usr/bin/env python3
"""Collect reproducible public deployment smoke observations into a local JSON file.

User-agent spoofing is only a simulated request, never proof of verified bot access.
No credentials or account APIs are used. Output should be written outside the repo.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.request import Request, build_opener
from urllib.error import HTTPError

from submit_indexnow import ORIGIN, Canonical, NoRedirect, valid_url, MAX_BODY

AGENTS = {"ordinary": "ChicagoBudget-Smoke/1.0", "googlebot-simulated": "Googlebot", "bingbot-simulated": "bingbot"}
DEFAULT_PATHS = ("/", "/robots.txt", "/sitemap-index.xml", "/llms.txt", "/methods")


def probe(url, user_agent, opener=None):
    opener = opener or build_opener(NoRedirect)
    request = Request(url, headers={"User-Agent": user_agent})
    try:
        response = opener.open(request, timeout=12)
    except HTTPError as error:
        response = error
    with response:
        body = response.read(MAX_BODY + 1)
        result = {"status": response.status, "final_url": response.geturl(), "content_type": response.headers.get("Content-Type", ""), "bytes_observed": len(body), "truncated": len(body) > MAX_BODY}
        if "text/html" in result["content_type"].lower() and not result["truncated"]:
            page = Canonical()
            page.feed(body.decode("utf-8", errors="replace"))
            result["canonical"] = page.links
            result["robots_meta"] = page.robots
        if url.endswith("/robots.txt") and not result["truncated"]:
            result["robots_text"] = body.decode("utf-8", errors="replace")
        return result


def collect(paths=DEFAULT_PATHS, opener=None):
    urls = [ORIGIN + path for path in paths]
    for url in urls:
        if url not in (ORIGIN + "/robots.txt", ORIGIN + "/sitemap-index.xml", ORIGIN + "/llms.txt"):
            valid_url(url)
    observations = []
    for url in urls:
        for label, agent in AGENTS.items():
            try:
                result = probe(url, agent, opener)
            except OSError as error:
                result = {"error_type": type(error).__name__}
            observations.append({"url": url, "agent_profile": label, **result})
    return {"schema_version": 1, "observed_at_utc": datetime.now(timezone.utc).isoformat(), "origin": ORIGIN, "bot_verification": "not_verified_user_agent_simulation_only", "observations": observations}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="JSON output path outside repository")
    parser.add_argument("--path", action="append", dest="paths", help="Additional or replacement canonical path; repeatable")
    args = parser.parse_args()
    try:
        if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
            raise ValueError("Write measurements to scratch outside the repository")
        result = collect(args.paths or DEFAULT_PATHS)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {len(result['observations'])} public observations to {args.output}")
    except (ValueError, OSError) as error:
        print(f"Smoke collection aborted: {error}", file=sys.stderr)
        sys.exit(1)
