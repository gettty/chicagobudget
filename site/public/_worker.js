// Cloudflare Pages advanced mode. ASSETS is the deployed static site, including
// the privacy-safe /data export. Never route asset lookups back through this worker.
const origin = 'https://chicagobudget.com';
const actionTypes = new Set(['budget_open', 'official_source_follow', 'dataset_download', 'permalink_share']);
const actionGovernments = new Set(['city', 'cps', 'parks', 'none']);
const eventReply = status => new Response(null, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});

// Counts are actions, not unique visitors. No user identifiers or request metadata
// are stored. The dashboard must not retain request logs for this route.
export async function handleActionEvent(request, env) {
  if (request.method !== 'POST') return eventReply(405);
  // Enable only after edge rate limiting and isolated D1 bindings are verified.
  if (env.ACTION_ANALYTICS_ENABLED !== 'true') return eventReply(503);
  const url = new URL(request.url);
  const production = url.hostname === 'chicagobudget.com';
  const preview = env.ACTION_ANALYTICS_PREVIEW === 'true' && env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== 'main' &&
    /^[a-z0-9-]+\.chicagobudget\.pages\.dev$/.test(url.hostname);
  if ((!production && !preview) || url.search || url.hash || request.headers.get('Origin') !== url.origin) return eventReply(403);
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return eventReply(204);
  if (!env.ACTION_COUNTS) return eventReply(503);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return eventReply(415);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 128) return eventReply(413);
  const reader = request.body?.getReader();
  if (!reader) return eventReply(400);
  let bytes = 0;
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 128) { await reader.cancel(); return eventReply(413); }
    chunks.push(value);
  }
  let payload;
  try {
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));
  } catch { return eventReply(400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== 'action,gov' ||
    !actionTypes.has(payload.action) || !actionGovernments.has(payload.gov)) return eventReply(400);
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.ACTION_COUNTS.prepare('INSERT INTO action_counts (day, action, gov, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, action, gov) DO UPDATE SET count = count + 1')
      .bind(day, payload.action, payload.gov).run();
  } catch { return eventReply(503); }
  return eventReply(204);
}
const governments = {city: 'City of Chicago', cps: 'Chicago Public Schools', parks: 'Chicago Park District'};
const basisLabels = {budget: 'In the budget', tied: 'Adds up exactly', gov_estimate: 'Government estimate', paid_to_date: 'Paid so far', proxy: 'Our estimate', residual: 'Leftover', adjustment: 'Adjustment'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const currencyFormatter = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
const money = cents => currencyFormatter.format(cents / 100);
const link = node => {
  const root = node.root || node.id.split('.')[0];
  return node.id === 'city-twice' ? '/city/counted-twice/' : node.id === root ? `/${root}/` : `/${root === 'city-twice' ? 'city' : root}/box/${encodeURIComponent(node.id)}/`;
};
const safeUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
const htmlResponse = (html, status, request) => {
  const headers = {'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
  // Pages' automatic preview noindex may not carry over to new Response bodies.
  if (new URL(request.url).hostname !== 'chicagobudget.com') headers['X-Robots-Tag'] = 'noindex';
  return new Response(request.method === 'HEAD' ? null : html, {status, headers});
};
const notFound = request => htmlResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Budget box not found | Chicago Budget</title><h1>Budget box not found</h1><p>This box is not in the published budget data.</p><a href="/find">Search budgets</a></html>', 404, request);
const unavailable = request => htmlResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Budget data temporarily unavailable</title><h1>Budget data temporarily unavailable</h1><p>Please retry this page shortly.</p></html>', 503, request);

async function assetJson(env, path) {
  const response = await env.ASSETS.fetch(new Request(`${origin}/data/${path}`, {headers: {Accept: 'application/json'}}));
  if (!response.ok) throw new Error(`Missing budget data: ${path} (${response.status})`);
  return response.json();
}

// FNV-1a over UTF-8, matched by scripts/build_fallback_data.py. No isolate-global
// cache or in-flight promise: each response uses only this deployment's ASSETS.
export function fallbackBucket(id) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return (hash & 1023).toString(16).padStart(3, '0');
}

function render(node, children, crumbs, sources, gov) {
  const canonical = `${origin}/${gov}/box/${encodeURIComponent(node.id)}/`;
  const period = node.period_label || (node.basis === 'paid_to_date' ? '' : gov === 'cps' ? 'FY2026 (July 2025–June 2026)' : 'Calendar year 2026');
  const title = `${node.name} Budget 2026 | Chicago Budget`;
  const description = `${node.name}: ${money(node.amount_cents)} in the ${governments[gov]} ${period || 'budget'} (${basisLabels[node.basis] || node.basis || 'budget'}). Explore the public-source breakdown.`;
  const anchors = crumbs.map(n => `<li><a href="${escape(link(n))}">${escape(n.name)}</a></li>`).join('');
  const items = children.map(n => `<li><a href="${escape(link(n))}">${escape(n.name)}</a>: ${escape(money(n.amount_cents))}${n.note ? ` · ${escape(n.note)}` : ''}${n.kind === 'rounding' ? ' (rounding)' : ''}</li>`).join('');
  const citations = sources.map(s => {
    const label = escape(s.name || s.doc || s.dataset || 'Public source');
    const url = safeUrl(s.url);
    return `<li>${url ? `<a href="${escape(url)}" rel="noopener noreferrer">${label}</a>` : label}${s.page ? `, page ${escape(s.page)}` : ''}${s.note ? ` · ${escape(s.note)}` : ''}</li>`;
  }).join('');
  const caveats = Array.isArray(node.caveats) ? node.caveats.filter(Boolean).map(c => `<li>${escape(c)}</li>`).join('') : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical)}"><style>body{font:1.1rem/1.6 system-ui,sans-serif;max-width:75ch;margin:auto;padding:1rem;color:#172b32}a{color:#07576b}header,footer{padding:1rem 0;border-bottom:1px solid #ccd}footer{border-top:1px solid #ccd}li{margin:.35rem 0}strong{font-size:1.5rem}</style></head><body><header><a href="/">Chicago Budget</a> · <a href="/${gov}/">${escape(governments[gov])}</a></header><main><nav aria-label="Breadcrumb"><ol>${anchors}<li aria-current="page">${escape(node.name)}</li></ol></nav><h1>${escape(node.name)}</h1><p>${escape(governments[gov])} · ${escape(period)} · ${escape(basisLabels[node.basis] || node.basis || 'Budget')}</p><p><strong>${escape(money(node.amount_cents))}</strong></p>${node.note ? `<p>${escape(node.note)}</p>` : ''}${node.why ? `<p>${escape(node.why)}</p>` : ''}${caveats ? `<section><h2>Important caveats</h2><ul>${caveats}</ul></section>` : ''}<p><a href="/#box=${encodeURIComponent(node.id)}">Open interactive view</a> · <a href="/find?budget=${gov}">Search this budget</a></p><section><h2>Inside this box</h2>${items ? `<ul>${items}</ul>` : '<p>This box has no smaller boxes to open.</p>'}</section><section><h2>Sources</h2>${citations ? `<ul>${citations}</ul>` : '<p>See the parent budget and <a href="/sources/">source catalog</a> for provenance.</p>'}</section><p><a href="/methods">How these figures are calculated</a></p></main><footer><p>Chicago Budget is an independent project, not affiliated with the City of Chicago, Chicago Public Schools, or the Chicago Park District.</p></footer></body></html>`;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/_events') return handleActionEvent(request, env);
    // Static assets take precedence, including prerendered boxes and /data.
    const staticResponse = await env.ASSETS.fetch(request);
    if (staticResponse.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return staticResponse;
    const url = new URL(request.url);
    const match = /^\/(city|cps|parks)\/box\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return staticResponse;
    const gov = match[1];
    let id;
    try { id = decodeURIComponent(match[2]); } catch { return notFound(request); }
    // Validate decoded IDs before using them in an asset path or canonical URL.
    if (id.length > 1024 || !/^[a-z0-9][a-z0-9.-]*$/.test(id) || id.includes('..') || !(id.startsWith(`${gov}.`) || (gov === 'city' && id.startsWith('city-twice.')))) return notFound(request);
    try {
    const shard = await assetJson(env, `fallback/${fallbackBucket(id)}.json`);
    if (shard?.version !== 1 || !shard.records || typeof shard.records !== 'object' || Array.isArray(shard.records)) throw new Error('Invalid fallback shard');
    if (!Object.hasOwn(shard.records, id)) return notFound(request);
    const record = shard.records[id];
    if (!Array.isArray(record) || record.length !== 4) throw new Error('Invalid fallback record');
    const [node, children, crumbs, sources] = record;
    const expectedRoot = id.startsWith('city-twice.') ? 'city-twice' : gov;
    if (node?.id !== id || (node.root && node.root !== expectedRoot) || !Array.isArray(children) || !Array.isArray(crumbs) || !Array.isArray(sources)) throw new Error('Invalid fallback record');
    return htmlResponse(render(node, children, crumbs, sources, gov), 200, request);
    } catch (error) {
      console.error('Budget data unavailable', error);
      return unavailable(request);
    }
  }
};
