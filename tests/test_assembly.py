"""Assembly preflight, source isolation and ownership-file regression checks."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('assembly', Path(__file__).resolve().parents[1] / 'scripts/assemble_production_site.py')
assembly = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assembly)


class AssemblyTests(unittest.TestCase):
    def fixture(self, base):
        site, lake = base / 'site', base / 'lake'
        for root in (site, lake):
            (root / 'data').mkdir(parents=True)
            (root / 'data/sources.json').write_text(root.name)
        (site / 'index.html').write_text('legacy')
        (site / '_redirects').write_text('/methods/ /methods 301')
        (lake / 'index.html').write_text('<link href="/visual-data/core.json">')
        (lake / 'methods.html').write_text('methods')
        (lake / 'data/core.json').write_text('{}')
        (lake / 'assets').mkdir()
        (lake / 'assets/app.js').write_text('fetch("/visual-data/core.json")')
        return site, lake

    def test_key_and_prior_manifest_pass_through_without_source_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            site, lake = self.fixture(base)
            key = base / 'private-key'
            key.write_text('example-key-12345\n')
            previous = base / 'previous.json'
            previous.write_text('{"routes":[]}')
            with patch.object(assembly.subprocess, 'run') as run:
                assembly.assemble(site, lake, previous, key)
            self.assertEqual((site / 'example-key-12345.txt').read_text(), 'example-key-12345')
            self.assertEqual((site / 'data/sources.json').read_text(), 'site')
            self.assertEqual((site / 'visual-data/sources.json').read_text(), 'lake')
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(len(commands), 3)
            self.assertTrue(commands[0][1].endswith('build_fallback_data.py'))
            self.assertEqual(commands[0][-2:], ['--data-dir', str(site / 'data')])
            self.assertTrue(commands[1][1].endswith('build_static_routes.py'))
            self.assertEqual(commands[1][-1], str(site))
            self.assertTrue(commands[2][1].endswith('build_discovery.py'))
            self.assertEqual(run.call_args.args[0][-2:], ['--previous-manifest', str(previous)])

    def test_invalid_key_fails_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            site, lake = self.fixture(base)
            key = base / 'key'
            key.write_text('../escape')
            with self.assertRaises(ValueError):
                assembly.assemble(site, lake, indexnow_key_file=key)
            self.assertEqual((site / 'index.html').read_text(), 'legacy')
            self.assertFalse((site / 'assets').exists())

    def test_missing_previous_fails_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            site, lake = self.fixture(base)
            with self.assertRaises(FileNotFoundError):
                assembly.assemble(site, lake, base / 'missing.json')
            self.assertEqual((site / 'index.html').read_text(), 'legacy')


if __name__ == '__main__':
    unittest.main()
