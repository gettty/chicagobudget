import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lib = readFileSync(join(root, 'site/src/lib/discovery.ts'), 'utf8');
const index = readFileSync(join(root, 'site/src/pages/datasets/index.astro'), 'utf8');
const detail = readFileSync(join(root, 'site/src/pages/datasets/2026/[gov].astro'), 'utf8');
const policy = JSON.parse(readFileSync(join(root, 'site/src/lib/route_lifecycle.json')));
const manifest = JSON.parse(readFileSync(join(root, 'data/public/2026/site/manifest.json')));
const revision = policy.snapshot_publication_revision;

function published(path) {
  return execFileSync('git', ['show', `${revision}:data/public/2026/${path}`], {cwd: root});
}

test('publication revision contains exact complete snapshot, not just export input', () => {
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert.notEqual(revision, manifest.commit);
  for (const path of ['catalog.json', 'site/manifest.json', 'tree/manifest.json',
                      'tree/lookup.json', 'tree/city/_root.json', 'tree/cps/_root.json', 'tree/parks/_root.json']) {
    const blob = execFileSync('git', ['rev-parse', `${revision}:data/public/2026/${path}`], {cwd: root, encoding: 'utf8'}).trim();
    const local = execFileSync('git', ['hash-object', join(root, 'data/public/2026', path)], {cwd: root, encoding: 'utf8'}).trim();
    assert.equal(blob, local, path);
  }
  assert.equal(JSON.parse(published('site/manifest.json')).commit, manifest.commit);
  const catalog = JSON.parse(published('catalog.json'));
  const checksum = catalog.files.find(file => file.path === 'tree/manifest.json')?.sha256;
  assert.equal(checksum, createHash('sha256').update(published('tree/manifest.json')).digest('hex'));
});

test('dataset labels and distributions distinguish export from immutable publication', () => {
  assert.match(lib, /snapshotPublicationRevision=lifecycle\.snapshot_publication_revision/);
  assert.match(lib, /tree\/\$\{snapshotPublicationRevision\}\/data\/public\/2026/);
  assert.match(lib, /raw\.githubusercontent\.com\/gettty\/chicagobudget\/\$\{snapshotPublicationRevision\}\/data\/public\/2026/);
  assert.match(lib, /snapshotExportRevision=publishedManifest\.commit/);
  assert.match(lib, /version:snapshotPublicationRevision/);
  assert.match(index, /Immutable publication revision/);
  assert.match(index, /source\/export revision/);
  assert.match(detail, /Source\/export revision/);
  assert.match(detail, /Immutable publication revision/);
  assert.match(detail, /data-build date, not the source publication date/);
  assert.match(detail, /citations come from the current interactive export/);
  assert.doesNotMatch(index + detail, /Snapshot version/);
});
