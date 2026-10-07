import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from xml.etree import ElementTree as ET

MODULE = Path(__file__).resolve().parents[1] / "scripts/build_discovery.py"
spec = importlib.util.spec_from_file_location("build_discovery", MODULE)
discovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discovery)


def page(directory, route, *, canonical=None, robots="", body=None):
    path = directory / (route.strip("/") + "/index.html" if route != "/" else "index.html")
    path.parent.mkdir(parents=True, exist_ok=True)
    canonical = canonical if canonical is not None else discovery.ORIGIN + route
    body = body if body is not None else "A budget page with actual public spending data and source documents. " * 4
    path.write_text(f'<html><head><title>{route}</title><link rel="canonical" href="{canonical}"><meta name="robots" content="{robots}"></head><body><h1>{route}</h1><main>{body}</main></body></html>')


def versions(directory, site="site-a", visual="visual-a"):
    for name, payload in (("data/manifest.json", {"commit": site}),
                          ("visual-data/core.json", {"meta": {"commit": visual}})):
        file = directory / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(payload))


class DiscoveryTests(unittest.TestCase):
    def test_canonical_policy(self):
        self.assertEqual(discovery.canonical_path("/methods/?q=x#top"), "/methods")
        self.assertEqual(discovery.canonical_path("/city/box/id?q=x"), "/city/box/id/")
        self.assertEqual(discovery.canonical_path("/"), "/")

    def test_filter_and_deterministic_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            versions(dist)
            page(dist, "/")
            page(dist, "/city/")
            page(dist, "/city/box/useful/")
            page(dist, "/cps/box/small-school/", body="School budget $12, source: CPS.")
            page(dist, "/city/box/noncanonical/", canonical=discovery.ORIGIN + "/")
            page(dist, "/city/box/noindex/", robots="noindex,follow")
            page(dist, "/city/box/shell/", body="Opening this box… Loading public budget data.")
            page(dist, "/find/")
            (dist / "robots.txt").write_text("User-agent: *\nAllow: /\n")
            routes = discovery.build(dist)
            self.assertEqual([r["path"] for r in routes], ["/", "/city/", "/city/box/useful/", "/cps/box/small-school/"])
            self.assertTrue(all(r["indexable"] and r["renderable"] for r in routes))
            self.assertTrue(all(len(r["content_digest"]) == 64 and r["data_version"] for r in routes))
            files = {p.name: p.read_bytes() for p in dist.glob("sitemap*.xml")}
            manifest = (dist / "discovery-manifest.json").read_bytes()
            discovery.build(dist)
            self.assertEqual(files, {p.name: p.read_bytes() for p in dist.glob("sitemap*.xml")})
            self.assertEqual(manifest, (dist / "discovery-manifest.json").read_bytes())
            self.assertNotIn(b"lastmod", files["sitemap-city.xml"])
            self.assertEqual(len(ET.fromstring(files["sitemap-city.xml"])), 2)
            self.assertIn("Allow: /", (dist / "robots.txt").read_text())
            self.assertEqual((dist / "robots.txt").read_text().count("Sitemap:"), 1)
            self.assertNotIn("/find/", (dist / "llms.txt").read_text())

    def test_deployment_comparison_and_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            versions(dist)
            page(dist, "/city/")
            baseline = discovery.build(dist)
            previous = dist / "prior.json"
            previous.write_text(json.dumps({"canonical_origin": discovery.ORIGIN, "routes": baseline}))
            page(dist, "/city/", body="Chicago budget changed from approved public source.")
            page(dist, "/parks/")
            discovery.build(dist, previous)
            changes = json.loads((dist / "discovery-changes.json").read_text())
            self.assertEqual([r["path"] for r in changes["changed"]], ["/city/"])
            self.assertEqual([r["path"] for r in changes["added"]], ["/parks/"])
            self.assertEqual(changes["removed"], [])
            self.assertNotIn(b"lastmod", (dist / "sitemap-city.xml").read_bytes())
            config = discovery.policy()
            config["lastmod"] = {"/city/": {"date": "2026-09-01", "source": "verified editorial revision"}}
            with mock.patch.object(discovery, "policy", return_value=config):
                discovery.build(dist)
            self.assertIn(b"2026-09-01", (dist / "sitemap-city.xml").read_bytes())

    def test_future_lastmod_rejected(self):
        config = discovery.policy()
        self.assertFalse(config["next_year"]["redirect_from_2026"])
        self.assertEqual(config["next_year"]["status"], "unpublished")

    def test_source_versions_and_semantic_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            versions(dist)
            for route in ("/", "/city/", "/datasets/2026/city/"):
                page(dist, route, body="Chicago budget $100 from public source.")
            old = {r["path"]: r for r in discovery.discover(dist)}
            self.assertEqual(old["/"]["data_version"], "visual-a")
            self.assertEqual(old["/city/"]["data_version"], "site-a")
            self.assertEqual(old["/datasets/2026/city/"]["data_version"], discovery.data_versions(dist)["snapshot"])
            versions(dist, site="site-b", visual="visual-b")
            unchanged = discovery.discover(dist)
            self.assertEqual(discovery.compare({"routes": list(old.values())}, unchanged)["changed"], [])
            page(dist, "/city/", body="Chicago budget $200 from public source.")
            updated = discovery.discover(dist)
            self.assertEqual([r["path"] for r in discovery.compare({"routes": list(old.values())}, updated)["changed"]], ["/city/"])
            page(dist, "/city/", body='Chicago budget $100 from <a href="https://agency.example/new-source">public source</a>.')
            self.assertNotEqual(old["/city/"]["version"], {r["path"]: r for r in discovery.discover(dist)}["/city/"]["version"])
            page(dist, "/city/", canonical=discovery.ORIGIN + "/city/alternate/")
            self.assertNotIn("/city/", [r["path"] for r in discovery.discover(dist)])

    def test_script_and_asset_hash_do_not_change_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            versions(dist)
            page(dist, "/city/")
            file = dist / "city/index.html"
            first = discovery.discover(dist)[0]["version"]
            file.write_text(file.read_text().replace("</head>", '<script src="/_astro/asset.abc.js"></script></head>'))
            self.assertEqual(first, discovery.discover(dist)[0]["version"])
            file.write_text(file.read_text().replace("asset.abc.js", "asset.def.js"))
            self.assertEqual(first, discovery.discover(dist)[0]["version"])

    def test_asset_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            versions(dist)
            page(dist, "/")
            previous = discovery.MAX_ASSETS
            try:
                discovery.MAX_ASSETS = 1
                with self.assertRaisesRegex(ValueError, "asset cap"):
                    discovery.build(dist)
            finally:
                discovery.MAX_ASSETS = previous


if __name__ == "__main__":
    unittest.main()
