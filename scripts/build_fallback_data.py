"""Build bounded, direct-addressed fallback records from the published privacy-safe data.

Usage: python3 scripts/build_fallback_data.py --data-dir site/public/data
"""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

BUCKETS = 1024
MAX_SHARD_BYTES = 512 * 1024
NODE_FIELDS = ('id', 'root', 'name', 'amount_cents', 'basis', 'period_label', 'note', 'why', 'caveats')
CHILD_FIELDS = ('id', 'root', 'name', 'amount_cents', 'note', 'kind')
CRUMB_FIELDS = ('id', 'root', 'name')
SOURCE_FIELDS = ('name', 'doc', 'dataset', 'url', 'page', 'note')


def project(value, fields):
    return {field: value[field] for field in fields if field in value}


def bucket_for_id(value):
    # FNV-1a over UTF-8, deliberately identical to the worker implementation.
    hashed = 2166136261
    for byte in value.encode('utf-8'):
        hashed = ((hashed ^ byte) * 16777619) & 0xffffffff
    return f'{hashed & (BUCKETS - 1):03x}'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def build_records(data_dir):
    manifest = read_json(data_dir / 'manifest.json')['chunks']
    spine = read_json(data_dir / 'spine.json')
    sources = read_json(data_dir / 'sources.json')
    chunks = {key: read_json(data_dir / path) for key, path in manifest.items()}
    records = {}
    for key, chunk in chunks.items():
        nodes = chunk['nodes']
        stubs = [dict(n, parent_id=n.get('parent_id') or n['id'].rsplit('.', 1)[0]) for n in chunk.get('stubs', [])]
        children_by_parent = {}
        for child in nodes + stubs + spine:
            children_by_parent.setdefault(child.get('parent_id'), {})[child['id']] = child
        nodes_by_id = {n['id']: n for n in nodes}
        spine_by_id = {n['id']: n for n in spine}
        for candidate in nodes + spine:
            node_id = candidate['id']
            if node_id in records:
                continue
            selected_key = max((k for k in manifest if node_id == k or node_id.startswith(k + '.')), key=len, default=None)
            if selected_key != key:
                continue
            root = 'city-twice' if node_id.startswith('city-twice.') else node_id.split('.')[0]
            node = nodes_by_id.get(node_id)
            if node is not None and node.get('root') != root:
                node = None
            if node is None:
                node = spine_by_id.get(node_id)
                if node is not None and node.get('root', root) != root:
                    node = None
            if node is None:
                continue
            children = list(children_by_parent.get(node_id, {}).values())
            children.sort(key=lambda n: -abs(n['amount_cents']))
            children = [project(dict(n, root=n.get('root') or root), CHILD_FIELDS) for n in children]
            by_id = {n['id']: n for n in spine}
            by_id.update((n['id'], n) for n in nodes)
            crumbs = []
            parent = node.get('parent_id')
            while parent and len(crumbs) < 30:
                if parent not in by_id:
                    parent_key = max((k for k in manifest if parent == k or parent.startswith(k + '.')), key=len, default=None)
                    if parent_key:
                        by_id.update((n['id'], n) for n in chunks[parent_key]['nodes'])
                ancestor = by_id.get(parent)
                if ancestor is None:
                    break
                crumbs.insert(0, project(ancestor, CRUMB_FIELDS))
                parent = ancestor.get('parent_id')
            indices = node.get('source') if isinstance(node.get('source'), list) else [node.get('source')]
            citations = [project(sources[i], SOURCE_FIELDS) for i in indices if type(i) is int and 0 <= i < len(sources) and sources[i]]
            records[node_id] = [project(node, NODE_FIELDS), children, crumbs, citations]
    return records


def build(data_dir):
    records = build_records(data_dir)
    shards = {f'{n:03x}': {} for n in range(BUCKETS)}
    for node_id, record in records.items():
        shards[bucket_for_id(node_id)][node_id] = record
    sizes = []
    payloads = {}
    for name, shard in shards.items():
        payload = json.dumps({'version': 1, 'records': shard}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(payload) > MAX_SHARD_BYTES:
            raise ValueError(f'Fallback shard {name} exceeds {MAX_SHARD_BYTES} bytes: {len(payload)}')
        sizes.append(len(payload))
        payloads[name] = payload
    output = data_dir / 'fallback'
    stage = Path(tempfile.mkdtemp(prefix='.fallback-stage-', dir=data_dir))
    backup = None
    replaced = False
    try:
        for name, payload in payloads.items():
            (stage / f'{name}.json').write_bytes(payload)
        if output.exists():
            backup = Path(tempfile.mkdtemp(prefix='.fallback-old-', dir=data_dir))
            backup.rmdir()
            os.replace(output, backup)
        try:
            os.replace(stage, output)
            replaced = True
        except BaseException:
            if backup is not None:
                os.replace(backup, output)
                backup = None
            raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if replaced and backup is not None and backup.exists():
            shutil.rmtree(backup)
    print(f'fallback: {len(records)} records, {len(shards)} shards, max {max(sizes)} bytes, median {sorted(sizes)[len(sizes)//2]} bytes')
    return records


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    build(parser.parse_args().data_dir)
