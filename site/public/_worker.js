// Cloudflare Pages advanced mode. ASSETS is the deployed static site, including
// the privacy-safe /data export. Never route asset lookups back through this worker.
const origin = 'https://chicagobudget.com';
const governments = {city: 'City of Chicago', cps: 'Chicago Public Schools', parks: 'Chicago Park District'};
const basisLabels = {budget: 'In the budget', tied: 'Adds up exactly', gov_estimate: 'Government estimate', paid_to_date: 'Paid so far', proxy: 'Our estimate', residual: 'Leftover', adjustment: 'Adjustment'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const money = cents => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);
const link = node => {
  const root = node.root || node.id.split('.')[0];
  return node.id === 'city-twice' ? '/city/counted-twice/' : node.id === root ? `/${root}/` : `/${root === 'city-twice' ? 'city' : root}/box/${encodeURIComponent(node.id)}/`;
};
const safeUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
const htmlResponse = (html, status, head) => new Response(head ? null : html, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff'}});
const notFound = head => htmlResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Budget box not found | Chicago Budget</title><h1>Budget box not found</h1><p>This box is not in the published budget data.</p><a href="/find">Search budgets</a></html>', 404, head);
const unavailable = head => htmlResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Budget data temporarily unavailable</title><h1>Budget data temporarily unavailable</h1><p>Please retry this page shortly.</p></html>', 503, head);

async function assetJson(env, path) {
  const response = await env.ASSETS.fetch(new Request(`${origin}/data/${path}`, {headers: {Accept: 'application/json'}}));
  if (!response.ok) throw new Error(`Missing budget data: ${path} (${response.status})`);
  return response.json();
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
    // Static assets take precedence, including prerendered boxes and /data.
    const staticResponse = await env.ASSETS.fetch(request);
    if (staticResponse.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return staticResponse;
    const url = new URL(request.url);
    const match = /^\/(city|cps|parks)\/box\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return staticResponse;
    const gov = match[1];
    let id;
    try { id = decodeURIComponent(match[2]); } catch { return notFound(request.method === 'HEAD'); }
    // Validate decoded IDs before using them in an asset path or canonical URL.
    if (id.length > 1024 || !/^[a-z0-9][a-z0-9.-]*$/.test(id) || id.includes('..') || !(id.startsWith(`${gov}.`) || (gov === 'city' && id.startsWith('city-twice.')))) return notFound(request.method === 'HEAD');
    try {
    const manifest = await assetJson(env, 'manifest.json');
    const keys = Object.keys(manifest.chunks).filter(key => id === key || id.startsWith(`${key}.`));
    const key = keys.sort((a, b) => b.length - a.length)[0];
    if (!key) return notFound(request.method === 'HEAD');
    const chunkPath = manifest.chunks[key];
    if (!/^chunks\/[a-f0-9]+\.json$/.test(chunkPath)) throw new Error('Invalid chunk manifest');
    const chunk = await assetJson(env, chunkPath);
    const spine = await assetJson(env, 'spine.json');
    const expectedRoot = id.startsWith('city-twice.') ? 'city-twice' : gov;
    const node = chunk.nodes.find(n => n.id === id && n.root === expectedRoot) || spine.find(n => n.id === id && (n.root || expectedRoot) === expectedRoot);
    if (!node) return notFound(request.method === 'HEAD');
    const children = [...(chunk.nodes || []), ...(chunk.stubs || []).map(n => ({...n, parent_id: n.parent_id || n.id.slice(0, n.id.lastIndexOf('.'))})), ...spine].filter(n => n.parent_id === id);
    const uniqueChildren = [...new Map(children.map(n => [n.id, n])).values()].sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents));
    const byId = new Map([...spine, ...chunk.nodes].map(n => [n.id, n]));
    const crumbs = [];
    let parent = node.parent_id;
    while (parent && crumbs.length < 30) {
      if (!byId.has(parent)) {
        const parentKey = Object.keys(manifest.chunks).filter(k => parent === k || parent.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0];
        if (parentKey) {
          const parentChunk = await assetJson(env, manifest.chunks[parentKey]);
          for (const candidate of parentChunk.nodes) byId.set(candidate.id, candidate);
        }
      }
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      crumbs.unshift(ancestor);
      parent = ancestor.parent_id;
    }
    const sourceData = await assetJson(env, 'sources.json');
    const indices = Array.isArray(node.source) ? node.source : [node.source];
    const sources = indices.filter(Number.isInteger).map(i => sourceData[i]).filter(Boolean);
    return htmlResponse(render(node, uniqueChildren.map(n => ({...n, root: n.root || expectedRoot})), crumbs, sources, gov), 200, request.method === 'HEAD');
    } catch (error) {
      console.error('Budget data unavailable', error);
      return unavailable(request.method === 'HEAD');
    }
  }
};
