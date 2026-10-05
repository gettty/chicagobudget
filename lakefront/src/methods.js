import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource-variable/source-serif-4/opsz';
import './styles/main.css';
import { loadCore, getMethods } from './lib/data.js';
import { money, words, exact, pct, count, BASIS } from './lib/format.js';
import { el } from './lib/ui.js';

const TITLES = { city: 'City of Chicago', cps: 'Chicago Public Schools', parks: 'Chicago Park District', 'city-twice': 'Money counted twice (City memo)' };
const GLOSSARY = [
  ['Budget', 'A plan for money a government expects to spend. It is not a list of checks already written.'],
  ['Fiscal year', 'The 12-month period a government uses for its budget. Different governments may start their years on different dates.'],
  ['Net and gross', 'Gross includes money moved between City funds that can be counted twice. Net removes that repeated money from the City total.'],
  ['Appropriation', 'Permission in a budget to spend up to an amount. It does not prove the money was paid.'],
  ['Full-time equivalent (FTE)', 'A measure of work hours. Two half-time jobs can add up to one FTE. It does not always count individual people.'],
  ['Contract', 'An agreement to buy goods or services. A contract amount is not the same as payments made under it.'],
  ['Vendor', 'A business or organization paid to provide goods or services. A payment is not automatically a separate budget line.'],
  ['Reserve or contingency', 'Money set aside before its final use is known. Without a matching project list, it stays one box.'],
  ['Negative amount', 'Money that takes away from a total, such as savings or a correction. It is never drawn as a tile.'],
  ['Pension shortfall', 'Pension benefits already promised but not yet saved for. Part of each year’s pension payment pays it down.'],
];

async function start() {
  const [core, m] = await Promise.all([loadCore(), getMethods()]);

  document.getElementById('labelList').replaceChildren(...Object.entries(BASIS).map(([k, [label, def]]) =>
    el('div', null, el('span', { class: 'badge' }, el('i', { class: 'b-' + k }), label), el('p', { style: { margin: 0 } }, def))));

  const r = m.reconcile;
  document.getElementById('reconcile').replaceChildren(
    el('span', null, el('b', null, money(r.net)), ' net City budget'), '+',
    el('span', null, el('b', null, money(r.twice)), ' counted twice'), '+',
    el('span', null, el('b', null, money(r.obm)), ' adjustment no line explains'), '=',
    el('span', null, el('b', null, money(r.gross)), ' gross ordinance'),
    el('p', { class: 'fine', style: { flexBasis: '100%', margin: '6px 0 0' } }, `${exact(r.net)} + ${exact(r.twice)} + ${exact(r.obm)} = ${exact(r.gross)}`));

  const BUCKETS = [['lt1m', 'Under $1M', '#2A78D6'], ['1m_10m', '$1M to $10M', '#86B6EF'], ['ge10m', '$10M or more', '#C9D2DB']];
  const cov = document.getElementById('coverage');
  cov.append(el('div', { class: 'ckey' }, BUCKETS.map(([, l, c]) => el('span', null, el('i', { style: { background: c } }), l))));
  for (const g of ['city', 'cps', 'parks']) {
    for (const rule of ['strict', 'build']) {
      const c = m.coverage[g][rule];
      cov.append(el('div', { class: 'crow' },
        el('span', null, `${TITLES[g]}${rule === 'build' ? ', build rule' : ''}`),
        el('div', { class: 'cbar', role: 'img', 'aria-label': BUCKETS.map(([k, l]) => `${l} ${pct(c[k])}`).join(', ') },
          BUCKETS.map(([k, , col]) => el('i', { style: { flexGrow: c[k], background: col, color: k === 'ge10m' ? '#0F1C2E' : '#fff' } }, c[k] > 0.08 ? pct(c[k], 0) : '')))));
    }
  }

  const gl = document.getElementById('gapList');
  const all = ['city', 'cps', 'parks'].flatMap((g) => m.gaps[g].map((x) => ({ ...x, g }))).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 12);
  gl.replaceChildren(...all.map((x) => el('li', null,
    el('div', null, el('b', null, money(x.amount)), el('a', { href: `/#box=${x.id}` }, x.path[x.path.length - 1] || x.id)),
    el('div', { class: 'gp' }, [TITLES[x.g], ...x.path.slice(0, -1)].join(' › ')),
    x.why ? el('p', null, x.why) : null)));

  const membersText = (p) => p.members.map((id) => {
    const row = core.top.find((t) => t[0] === id);
    return row ? row[1] : id;
  }).join(', ');
  document.getElementById('purposeRows').replaceChildren(...[...core.purposes].sort((a, b) => b.amount - a.amount).map((p) =>
    el('tr', null, el('td', null, p.name), el('td', null, membersText(p)), el('td', { class: 'n' }, money(p.amount)))));

  const ind = core.individuals || [];
  const ytd = ind.find((x) => x.period === 'city_2026_payments');
  if (ytd) document.getElementById('individuals').textContent = `In 2026 so far, the City made ${count(ytd.n_payments)} payments totalling ${words(ytd.amount_cents)} to individuals. They are counted in the totals but never named.`;

  document.getElementById('glossaryList').replaceChildren(...GLOSSARY.map(([t, d]) => el('div', null, el('dt', null, t), el('dd', null, d))));

  const sl = document.getElementById('sourceLists');
  for (const g of ['city', 'cps', 'parks']) {
    sl.append(el('h3', { style: { fontFamily: 'var(--serif)', fontSize: '20px', margin: '18px 0 6px' } }, TITLES[g]),
      el('ul', { class: 'srcs' }, (m.sources[g] || []).slice(0, 8).map((s) =>
        el('li', null, s.url && /^https?:\/\//.test(s.url) ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label) : s.label, ` · ${count(s.boxes)} boxes`))));
  }
  document.querySelectorAll('[data-meta]').forEach((n) => { const v = core.meta[n.dataset.meta]; if (typeof v === 'number') n.textContent = words(v); });
  const built = new Date(m.run_at);
  document.getElementById('built').textContent = `Data from the ChicagoBudget.com export built ${built.toLocaleDateString('en-US', { dateStyle: 'long' })} (commit ${m.commit.slice(0, 7)}), ${count(m.counts.nodes)} boxes.`;
}

start();
