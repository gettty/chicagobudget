import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import submit_indexnow as indexnow
import collect_deploy_smoke as smoke


class IndexNowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.route = {"url": indexnow.ORIGIN + "/city/", "path": "/city/", "version": "abc", "indexable": True, "renderable": True}
        self.changes = self.folder / "discovery-changes.json"
        self.manifest = self.folder / "discovery-manifest.json"
        self.previous = self.folder / "previous-manifest.json"
        prior_route = {**self.route, "url": indexnow.ORIGIN + "/", "path": "/", "version": "old"}
        self.previous.write_text(json.dumps({"canonical_origin": indexnow.ORIGIN, "schema_version": 2, "routes": [prior_route]}))
        self.save(removed=[prior_route])

    def save(self, added=None, changed=None, removed=None, routes=None):
        self.changes.write_text(json.dumps({"added": [self.route] if added is None else added, "changed": changed or [], "removed": removed or []}))
        self.manifest.write_text(json.dumps({"canonical_origin": indexnow.ORIGIN, "schema_version": 2, "routes": [self.route] if routes is None else routes}))

    def test_dry_run_never_networks_or_reads_key(self):
        def forbidden(*args):
            raise AssertionError("network called")
        with patch.dict(os.environ, {"INDEXNOW_KEY": ""}), contextlib.redirect_stdout(io.StringIO()) as output:
            indexnow.run(self.changes, fetcher=forbidden)
        self.assertIn('"mode": "dry-run"', output.getvalue())

    def test_submit_validates_key_and_live_before_post(self):
        key = "12345678abcdef"
        calls = []
        def fake(url, method="GET", data=None):
            calls.append((url, method))
            if url == indexnow.ORIGIN + "/" + key + ".txt":
                return 200, key.encode(), url
            if url == self.route["url"]:
                return 200, f'<link rel="canonical" href="{url}"><h1>City budget</h1>'.encode(), url
            if url == indexnow.ORIGIN + "/":
                return 410, b"", url
            self.assertEqual(method, "POST")
            payload = json.loads(data)
            self.assertEqual(payload["urlList"], [self.route["url"], indexnow.ORIGIN + "/"])
            self.assertEqual(payload["host"], indexnow.HOST)
            return 202, b"", url
        with patch.dict(os.environ, {"INDEXNOW_KEY": key}), contextlib.redirect_stdout(io.StringIO()) as output:
            indexnow.run(self.changes, submit=True, previous_manifest=self.previous, fetcher=fake)
        self.assertEqual(len(calls), 4)
        self.assertNotIn(key, output.getvalue())

    def test_removal_requires_real_404_or_410(self):
        self.save(added=[], removed=[self.route], routes=[])
        self.assertEqual(indexnow.load_delta(self.changes), [("removed", self.route["url"])])
        indexnow.validate_live([("removed", self.route["url"])], lambda url: (410, b"", url))
        with self.assertRaisesRegex(ValueError, "404/410"):
            indexnow.validate_live([("removed", self.route["url"])], lambda url: (200, b"", url))

    def test_rejects_untrusted_and_ambiguous_hosts(self):
        for url in ("http://chicagobudget.com/", "https://chicagobudget.com.evil/", "https://chicagobudget.com:443/", "https://chicagobudget.com/%2f/", "https://chicagobudget.com/city/?x=1"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                indexnow.valid_url(url)

    def test_rejects_stale_or_mismatched_manifest(self):
        os.utime(self.changes, (time.time() - 90000, time.time() - 90000))
        with self.assertRaisesRegex(ValueError, "stale"):
            indexnow.load_delta(self.changes)
        self.save(routes=[])
        with self.assertRaisesRegex(ValueError, "match"):
            indexnow.load_delta(self.changes)

    def test_rejects_full_resubmit_and_duplicate(self):
        self.save(added=[self.route], changed=[self.route])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            indexnow.load_delta(self.changes)
        entries = [{**self.route, "url": indexnow.ORIGIN + f"/city/{i}/", "path": f"/city/{i}/"} for i in range(10001)]
        self.save(added=entries, routes=entries)
        with self.assertRaisesRegex(ValueError, "10000"):
            indexnow.load_delta(self.changes)

    def test_submission_requires_matching_nonempty_previous(self):
        with self.assertRaisesRegex(ValueError, "previous-manifest"):
            indexnow.verify_previous(None, self.changes)
        self.save(removed=[])
        with self.assertRaisesRegex(ValueError, "does not match"):
            indexnow.verify_previous(self.previous, self.changes)
        prior_route = json.loads(self.previous.read_text())["routes"][0]
        self.save(removed=[prior_route])
        indexnow.verify_previous(self.previous, self.changes)
        self.previous.write_text(json.dumps({"canonical_origin": indexnow.ORIGIN, "schema_version": 2, "routes": []}))
        with self.assertRaisesRegex(ValueError, "nonempty"):
            indexnow.verify_previous(self.previous, self.changes)

    def test_key_exact_and_live_canonical(self):
        with self.assertRaisesRegex(ValueError, "exact"):
            indexnow.verify_key("12345678", lambda url: (200, b"12345678\n", url))
        with self.assertRaisesRegex(ValueError, "canonical"):
            indexnow.validate_live([("added", self.route["url"])], lambda url: (200, b'<meta name="robots" content="noindex">', url))

    def test_smoke_labels_simulated_bots(self):
        class FakeResponse:
            status = 200
            headers = {"Content-Type": "text/html"}
            def geturl(self): return indexnow.ORIGIN + "/"
            def read(self, size): return b'<link rel="canonical" href="https://chicagobudget.com/">'
            def __enter__(self): return self
            def __exit__(self, *args): pass
        class FakeOpener:
            def open(self, request, timeout): return FakeResponse()
        result = smoke.collect(["/"], opener=FakeOpener())
        self.assertEqual(len(result["observations"]), 3)
        self.assertEqual(result["bot_verification"], "not_verified_user_agent_simulation_only")
        self.assertEqual(result["observations"][0]["canonical"], [indexnow.ORIGIN + "/"])


if __name__ == "__main__":
    unittest.main()
