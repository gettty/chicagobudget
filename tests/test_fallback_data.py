import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_fallback_data import BUCKETS, MAX_SHARD_BYTES, NODE_FIELDS, CHILD_FIELDS, CRUMB_FIELDS, SOURCE_FIELDS, bucket_for_id, build, build_records, project


class FallbackDataTests(unittest.TestCase):
    def test_hash_vectors_and_equivalence(self):
        self.assertEqual(bucket_for_id('city.public-safety'), '00e')
        with tempfile.TemporaryDirectory() as temporary:
            data = Path(temporary)
            (data / 'chunks').mkdir()
            root = {'id': 'city', 'root': 'city', 'name': 'City', 'amount_cents': 100, 'parent_id': None}
            branch = {'id': 'city.branch', 'root': 'city', 'name': 'Branch', 'amount_cents': 90, 'parent_id': 'city', 'source': [0, 2]}
            leaf = {'id': 'city.branch.leaf', 'root': 'city', 'name': 'Leaf', 'amount_cents': 50, 'parent_id': 'city.branch', 'source': 1,
                    'note': 'Important note', 'why': 'Reason', 'caveats': ['Limited scope'], 'extra': {'private': 'not rendered'}}
            stub = {'id': 'city.other', 'name': 'Other', 'amount_cents': 10}
            files = {
                'manifest.json': {'chunks': {'city': 'chunks/root.json', 'city.branch': 'chunks/branch.json'}},
                'spine.json': [root, branch],
                'sources.json': [{'name': 'A'}, {'name': 'B'}, {'name': 'C'}],
                'chunks/root.json': {'nodes': [root], 'stubs': [branch, stub]},
                'chunks/branch.json': {'nodes': [branch, leaf], 'stubs': []},
            }
            for path, content in files.items():
                (data / path).write_text(json.dumps(content))
            records = build(data)
            self.assertEqual(len(list((data / 'fallback').glob('*.json'))), BUCKETS)
            self.assertEqual(records['city'][1], [project(branch, CHILD_FIELDS), project({**stub, 'root': 'city'}, CHILD_FIELDS)])
            self.assertEqual(records['city.branch'][2], [project(root, CRUMB_FIELDS)])
            self.assertEqual(records['city.branch'][3], [{'name': 'A'}, {'name': 'C'}])
            self.assertEqual(records['city.branch.leaf'][2], [project(root, CRUMB_FIELDS), project(branch, CRUMB_FIELDS)])
            self.assertNotIn('parent_id', records['city.branch'][0])
            self.assertEqual(records['city.branch.leaf'][0]['note'], 'Important note')
            self.assertEqual(records['city.branch.leaf'][0]['why'], 'Reason')
            self.assertEqual(records['city.branch.leaf'][0]['caveats'], ['Limited scope'])
            self.assertNotIn('extra', records['city.branch.leaf'][0])
            for node_id, record in records.items():
                shard = json.loads((data / 'fallback' / f'{bucket_for_id(node_id)}.json').read_text())
                self.assertEqual(shard['version'], 1)
                self.assertEqual(shard['records'][node_id], record)
            self.assertLessEqual(max(f.stat().st_size for f in (data / 'fallback').glob('*.json')), MAX_SHARD_BYTES)
            sentinel = data / 'fallback' / 'stale.json'
            sentinel.write_text('sentinel')
            with patch('scripts.build_fallback_data.MAX_SHARD_BYTES', 20):
                with self.assertRaises(ValueError):
                    build(data)
            self.assertEqual(sentinel.read_text(), 'sentinel')
            build(data)
            self.assertFalse(sentinel.exists())
            self.assertEqual(len(list((data / 'fallback').iterdir())), BUCKETS)

    def test_published_data_sample_preserves_old_selection(self):
        data = Path('site/public/data')
        if not (data / 'manifest.json').exists():
            self.skipTest('published data unavailable')
        manifest = json.loads((data / 'manifest.json').read_text())['chunks']
        spine = json.loads((data / 'spine.json').read_text())
        sources = json.loads((data / 'sources.json').read_text())
        records = build_records(data)
        chunks = {key: json.loads((data / path).read_text()) for key, path in manifest.items()}
        exported_ids = {n['id'] for n in spine}
        exported_ids.update(n['id'] for chunk in chunks.values() for n in chunk['nodes'])
        self.assertEqual(set(records), exported_ids, 'every exported node and spine ID has a fallback record')
        for node_id in ['city.public-safety', 'cps', 'parks', 'city-twice']:
            self.assertIn(node_id, records)
            key = max((k for k in manifest if node_id == k or node_id.startswith(k + '.')), key=len)
            chunk = chunks[key]
            root = 'city-twice' if node_id.startswith('city-twice.') else node_id.split('.')[0]
            node = next((n for n in chunk['nodes'] if n['id'] == node_id and n['root'] == root), None) or next((n for n in spine if n['id'] == node_id and n.get('root', root) == root), None)
            self.assertEqual(records[node_id][0], project(node, NODE_FIELDS))
            children = chunk['nodes'] + [{**n, 'parent_id': n.get('parent_id') or n['id'].rsplit('.', 1)[0]} for n in chunk.get('stubs', [])] + spine
            children = list({n['id']: n for n in children if n.get('parent_id') == node_id}.values())
            children.sort(key=lambda n: -abs(n['amount_cents']))
            self.assertEqual(records[node_id][1], [project({**n, 'root': n.get('root') or root}, CHILD_FIELDS) for n in children])
            indices = node.get('source') if isinstance(node.get('source'), list) else [node.get('source')]
            self.assertEqual(records[node_id][3], [project(sources[i], SOURCE_FIELDS) for i in indices if type(i) is int and 0 <= i < len(sources) and sources[i]])


if __name__ == '__main__':
    unittest.main()
