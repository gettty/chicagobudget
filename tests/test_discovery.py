import importlib.util
from pathlib import Path
import tempfile
import unittest
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


class DiscoveryTests(unittest.TestCase):
    def test_canonical_policy(self):
        self.assertEqual(discovery.canonical_path("/methods/?q=x#top"), "/methods")
        self.assertEqual(discovery.canonical_path("/city/box/id?q=x"), "/city/box/id/")
        self.assertEqual(discovery.canonical_path("/"), "/")

    def test_filter_and_deterministic_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            page(dist, "/")
            page(dist, "/city/")
            page(dist, "/city/box/useful/")
            page(dist, "/city/box/noncanonical/", canonical=discovery.ORIGIN + "/")
            page(dist, "/city/box/noindex/", robots="noindex,follow")
            page(dist, "/city/box/shell/", body="Opening this box… Loading public budget data.")
            page(dist, "/find/")
            (dist / "robots.txt").write_text("User-agent: *\nAllow: /\n")
            routes = discovery.build(dist)
            self.assertEqual([r["path"] for r in routes], ["/", "/city/", "/city/box/useful/"])
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

    def test_asset_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
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
