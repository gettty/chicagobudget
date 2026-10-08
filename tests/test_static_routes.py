"""Safety and determinism checks for Pages static box exclusions."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_static_routes import build_routes  # noqa: E402


INCLUDES = ["/city/box/*", "/cps/box/*", "/parks/box/*", "/_events"]


class StaticRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.dist = Path(self.temporary.name)
        self.routes_file = self.dist / "_routes.json"
        self.routes_file.write_text(json.dumps({"version": 1, "include": INCLUDES,
                                               "exclude": ["/stale/*"]}))

    def page(self, section, box_id):
        path = self.dist / section / "box" / box_id / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("static")

    def test_exact_static_paths_limits_and_repeatability(self):
        for section in ("city", "cps", "parks"):
            for index in range(60):
                self.page(section, f"{section}.category-{index:03}")
        self.page("city", "city." + "very-long-" * 12)
        (self.dist / "city/box/city.dynamic").mkdir()
        first = build_routes(self.dist)
        first_bytes = self.routes_file.read_bytes()
        self.assertEqual(build_routes(self.dist), first)
        self.assertEqual(self.routes_file.read_bytes(), first_bytes)
        self.assertEqual(first["include"], INCLUDES)
        self.assertEqual(first["version"], 1)
        self.assertEqual(len(first["exclude"]), 96)
        self.assertLessEqual(len(first["include"]) + len(first["exclude"]), 100)
        for rule in first["include"] + first["exclude"]:
            self.assertLessEqual(len(rule), 100)
        for rule in first["exclude"]:
            self.assertNotIn("*", rule)
            self.assertNotIn("?", rule)
            self.assertNotEqual(rule, "/_events")
            self.assertTrue((self.dist / rule.lstrip("/") / "index.html").is_file())
            self.assertIn(rule.rstrip("/") + "/", first["exclude"])
            self.assertIn(rule.rstrip("/"), first["exclude"])
        self.assertNotIn("/stale/*", first["exclude"])
        self.assertNotIn("/city/box/city.dynamic", first["exclude"])

    def test_stale_output_recomputed_after_static_page_removed(self):
        self.page("city", "city.alpha")
        self.page("cps", "cps.beta")
        self.assertEqual(len(build_routes(self.dist)["exclude"]), 4)
        (self.dist / "city/box/city.alpha/index.html").unlink()
        self.assertEqual(build_routes(self.dist)["exclude"],
                         ["/cps/box/cps.beta", "/cps/box/cps.beta/"])

    def test_invalid_includes_do_not_overwrite_existing_routes(self):
        original = {"version": 1, "include": ["/x" * 51], "exclude": []}
        self.routes_file.write_text(json.dumps(original))
        before = self.routes_file.read_bytes()
        with self.assertRaises(ValueError):
            build_routes(self.dist)
        self.assertEqual(self.routes_file.read_bytes(), before)

    def test_absent_box_dirs_keep_dynamic_routes(self):
        self.assertEqual(build_routes(self.dist)["exclude"], [])
        self.assertEqual(json.loads(self.routes_file.read_text())["include"], INCLUDES)


if __name__ == "__main__":
    unittest.main()
