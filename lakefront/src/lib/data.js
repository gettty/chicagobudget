// The budget store. core.json paints the first screen; tree.json (all 47,360 boxes) loads in the
// background; per-box details load on demand. Nothing here is fetched from a third party.

const BASE = import.meta.env.VITE_DATA_BASE || import.meta.env.BASE_URL + 'data/';
const byId = new Map();
let core = null;
let treePromise = null;
let treeLoaded = false;
let sourcesPromise = null;
const detailFiles = new Map();
let chunkSize = 400;

const getJSON = (path) =>
  fetch(BASE + path).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });

const parentId = (id) => (id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null);

export async function loadCore() {
  core = await getJSON('core.json');
  chunkSize = core.meta.chunk;
  // core.top holds every box down to depth 3 (2 for the memo branch), largest first. A box at that
  // edge keeps kids = null ("not loaded yet") until tree.json arrives.
  for (const [id, name, amount, kind, leaf, basis] of core.top) {
    byId.set(id, { id, name, amount, kind, basis, leaf: !!leaf, parent: parentId(id), kids: leaf ? [] : null });
  }
  for (const n of byId.values()) {
    const p = n.parent && byId.get(n.parent);
    if (p) (p.kids ||= []).push(n.id);
  }
  return core;
}

export const getCore = () => core;
export const get = (id) => byId.get(id);
export const isTreeLoaded = () => treeLoaded;

/** Children of a box, largest first. Null means "not loaded yet". */
export function children(id) {
  const n = byId.get(id);
  if (!n) return null;
  if (n.leaf) return [];
  if (!n.kids) return null;
  return n.kids.map((k) => byId.get(k));
}

export function path(id) {
  const out = [];
  let cur = byId.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return out;
}

export function loadTree() {
  if (treePromise) return treePromise;
  treePromise = getJSON('tree.json').then((t) => {
    const ids = new Array(t.nodes.length);
    const fresh = new Map();
    t.nodes.forEach(([seg, p, name, amount, k, b, leaf], i) => {
      const id = p < 0 ? seg : ids[p] + '.' + seg;
      ids[i] = id;
      const n = { id, name, amount, kind: t.kinds[k], basis: t.bases[b], leaf: !!leaf, parent: p < 0 ? null : ids[p], kids: leaf ? [] : [], idx: i };
      fresh.set(id, n);
      if (p >= 0) fresh.get(ids[p]).kids.push(id);
    });
    byId.clear();
    for (const [id, n] of fresh) byId.set(id, n);
    chunkSize = t.chunk;
    treeLoaded = true;
    contextReady = false;
    return true;
  }).catch((error) => {
    treePromise = null;
    throw error;
  });
  return treePromise;
}

/** Ensure a box (and the path to it) is known; loads the tree when needed. */
export async function ensure(id) {
  const n = byId.get(id);
  if (n && (n.leaf || n.kids)) return n;
  await loadTree();
  return byId.get(id);
}

/** Details for one box: why it stops, notes, side facts, sources, pay-versus-things mix. */
export async function details(id) {
  await loadTree();
  const n = byId.get(id);
  if (!n) return null;
  const file = Math.floor(n.idx / chunkSize);
  if (!detailFiles.has(file)) {
    const request = getJSON(`details/${file}.json`).catch(() => {
      detailFiles.delete(file);
      return {};
    });
    detailFiles.set(file, request);
  }
  const d = await detailFiles.get(file);
  return d[String(n.idx)] || {};
}

export function sources() {
  return (sourcesPromise ||= getJSON('sources.json').catch(() => []));
}

export const getMethods = () => getJSON('methods.json');

/** Every box under `id` whose kind matches, searched to `depth` levels. */
export function descendants(id, kind, depth = 3) {
  const out = [];
  const visit = (nid, d) => {
    const n = byId.get(nid);
    if (!n || !n.kids || d > depth) return;
    for (const k of n.kids) {
      const c = byId.get(k);
      if (c.kind === kind) out.push(c);
      else visit(k, d + 1);
    }
  };
  visit(id, 1);
  return out;
}

let contextReady = false;
function buildContext() {
  // Each box can be found by the names of the department-level boxes above it, so
  // "overtime fire" finds Overtime inside the Fire Department.
  for (const n of byId.values()) {
    n._low = n.name.toLowerCase();
    const anc = [];
    let p = n.parent ? byId.get(n.parent) : null;
    while (p) {
      const depth = p.id.split('.').length - 1;
      if (depth >= 1 && depth <= 3) anc.push(p.name.toLowerCase());
      p = p.parent ? byId.get(p.parent) : null;
    }
    n._ctx = anc.join(' ');
  }
  contextReady = true;
}

/** Search all boxes. Every word must appear in the name or the department above it, and at least one in the name. */
export function search(term, limit = 9) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (!contextReady) buildContext();
  const t = words.join(' ');
  const hits = [];
  for (const n of byId.values()) {
    let inName = 0, ok = true;
    for (const w of words) {
      if (n._low.includes(w)) inName++;
      else if (!n._ctx.includes(w)) { ok = false; break; }
    }
    if (ok && inName) hits.push({ n, score: inName * 4 + (n._low.startsWith(t) ? 2 : 0) + (n._low === t ? 3 : 0) });
  }
  hits.sort((a, b) => b.score - a.score || Math.abs(b.n.amount) - Math.abs(a.n.amount));
  return hits.slice(0, limit).map((h) => h.n);
}

export const govOf = (id) => (id ? id.split('.')[0] : null);
