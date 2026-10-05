import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = (await readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'))
  .replace('import.meta.env.BASE_URL', "'/'");

async function store(fetcher) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);
  return { module, restore: () => { globalThis.fetch = previous; } };
}

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const tree = { nodes: [['root', -1, 'Root', 10, 0, 0, 0], ['child', 0, 'Child', 5, 0, 0, 1]], kinds: ['budget'], bases: ['actual'], chunk: 400 };

test('failed tree request retries for search, ensure, and details', async () => {
  let attempts = 0;
  const { module: data, restore } = await store(async (url) => {
    if (url.endsWith('tree.json')) return ++attempts === 1 ? response(null, 503) : response(tree);
    if (url.endsWith('details/0.json')) return response({ 1: { note: 'recovered' } });
    throw new Error(`Unexpected URL ${url}`);
  });
  try {
    await assert.rejects(data.loadTree(), /tree.json: 503/);
    assert.equal(data.isTreeLoaded(), false);
    assert.equal(data.search('child').length, 0);
    assert.equal((await data.ensure('root.child')).name, 'Child');
    assert.equal(data.search('child')[0].id, 'root.child');
    assert.deepEqual(await data.details('root.child'), { note: 'recovered' });
    assert.equal(attempts, 2);
  } finally { restore(); }
});

test('failed detail chunk returns fallback once, then retries and caches success', async () => {
  let attempts = 0;
  const { module: data, restore } = await store(async (url) => {
    if (url.endsWith('tree.json')) return response(tree);
    if (url.endsWith('details/0.json')) return ++attempts === 1
      ? response(null, 503)
      : response({ 1: { note: 'recovered' } });
    throw new Error(`Unexpected URL ${url}`);
  });
  try {
    assert.deepEqual(await data.details('root.child'), {});
    assert.deepEqual(await data.details('root.child'), { note: 'recovered' });
    assert.deepEqual(await data.details('root.child'), { note: 'recovered' });
    assert.equal(attempts, 2);
  } finally { restore(); }
});
