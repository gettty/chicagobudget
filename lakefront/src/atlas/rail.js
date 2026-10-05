import * as D from '../lib/data.js';
import { money, words, exact, pct, perHead, count, BASIS } from '../lib/format.js';
import { COL, INK, el } from '../lib/ui.js';

const CAVEAT = {
  midyear_2025_coding: 'Its vendor list comes from mid-2025 contract coding, so it may not match this year’s line exactly.',
  also_on_other_lines: 'This project also appears on other budget lines. Do not add those boxes together.',
  cps_vendor_total: 'This is a CPS supplier total for the fiscal year that CPS did not tie to one budget line.',
};
const MIX = [['people', 'Pay for today’s workers', COL.people], ['things', 'Services, supplies & construction', COL.things], ['past', 'Pensions & debt', COL.past]];
let railToken = 0;

/** The detail rail for one box. Everything from the data is inserted as text, never as HTML. */
export async function renderRail(rail, ctx) {
  const t = ++railToken;
  const { id, nodeOf, parentOf, govOf, linkGov, core, PURP, GOV } = ctx;
  const n = nodeOf(id);
  if (!n) { rail.replaceChildren(el('p', null, 'This box is not in the data.')); return; }
  const POP = core.meta.population;
  const g = govOf(id);
  const pid = parentOf(id);
  const parent = pid ? nodeOf(pid) : null;

  const kicker = id === 'all' ? 'City · CPS · Park District, 2026'
    : id.startsWith('p:') ? 'A purpose, across all three budgets'
      : g === 'city-twice' ? 'Memo: not part of any total'
        : `${GOV[g].name} · ${GOV[g].period}`;
  const head = [
    el('div', { class: 'rk' }, kicker),
    el('h3', null, n.name),
    el('div', { class: 'ramt' }, money(n.amount)),
    el('div', { class: 'rmeta' }, `${exact(n.amount)} · ${perHead(n.amount, POP)} per Chicagoan`),
  ];
  if (parent && n.amount > 0 && parent.amount > 0) {
    const sh = n.amount / parent.amount;
    head.push(el('div', { class: 'share' },
      el('div', { class: 'rmeta' }, `${pct(sh)} of ${parent.name}`),
      el('div', { class: 'meter' }, el('i', { style: { width: Math.min(100, sh * 100) + '%', background: g ? COL[g === 'city-twice' ? 'twice' : g] : INK } }))));
  }
  rail.replaceChildren(...head, el('div', { class: 'rbody', 'aria-busy': 'true' }));
  const body = rail.querySelector('.rbody');

  if (id === 'all') {
    body.replaceChildren(
      el('p', null, 'Three separate governments with separate budgets, shown together for scale. CPS budgets July to June; the City and the Park District budget by calendar year.'),
      el('p', null, `${count(core.meta.nodes)} boxes in all. Each one equals the boxes inside it, to the cent.`));
    body.removeAttribute('aria-busy');
    return;
  }
  if (id.startsWith('p:')) {
    const p = PURP[id.slice(2)];
    body.replaceChildren(el('p', null, p.desc + '.'), splitBar(p.byGov, core), el('p', { class: 'fine' }, 'Purposes group the top-level boxes of each budget. They are this site’s grouping, not an official category.'));
    body.removeAttribute('aria-busy');
    return;
  }

  let d = {};
  try { d = (await D.details(id)) || {}; } catch { d = {}; }
  if (t !== railToken) return;
  const parts = [];
  if (d.o && d.o !== n.name) parts.push(el('p', { class: 'fine' }, `Official name: ${d.o}`));
  if (d.f) parts.push(el('p', { class: 'fine' }, `Full name: ${d.f}`));
  const mixEl = mixBar(d.ty);
  if (mixEl) parts.push(mixEl);
  const [blab, bdef] = BASIS[n.basis] || [n.basis, ''];
  parts.push(el('div', { class: 'badge', title: bdef }, el('i', { class: 'b-' + n.basis }), blab));
  if (bdef) parts.push(el('p', { class: 'fine' }, bdef + (d.pl ? ` Period: ${d.pl}.` : '')));
  if (d.pos) parts.push(el('p', null, `${count(d.pos)} budgeted ${d.pos === 1 ? 'position' : 'positions'} inside.`));
  if (d.c && d.u) {
    const unit = d.ul || 'units';
    parts.push(el('p', null, `${count(d.c)} ${unit} × ${exact(d.u)}${d.fk === 'hourly' ? ' an hour' : d.fk === 'monthly' ? ' a month' : ''}`));
  }
  if (n.leaf) parts.push(el('p', { class: 'why' }, d.w || 'This is as far down as the published data goes.'));
  else parts.push(el('p', null, `${count((n.kids || []).length)} boxes inside. Click one to open it.`));
  if (d.n && d.n !== d.w) parts.push(el('p', { class: 'note' }, d.n));
  for (const c of d.cv || []) if (CAVEAT[c]) parts.push(el('p', { class: 'caveat' }, CAVEAT[c]));
  if (d.x) parts.push(...extras(d.x));
  if (d.sd && d.sd.length) parts.push(facts(d.sd, n, t));
  const srcIdx = [].concat(d.s ?? []).filter((x) => Number.isInteger(x));
  if (srcIdx.length) {
    const box = el('div', { class: 'sources' }, el('h4', null, srcIdx.length > 1 ? 'Sources' : 'Source'));
    parts.push(box);
    D.sources().then((all) => {
      if (t !== railToken) return;
      for (const i of srcIdx.slice(0, 4)) box.append(sourceLine(all[i]));
    });
  }
  const gov = linkGov(id);
  const href = id === gov ? `https://chicagobudget.com/${gov}` : id === 'city-twice' ? 'https://chicagobudget.com/city/counted-twice' : `https://chicagobudget.com/${gov}/box/${id}`;
  parts.push(el('a', { class: 'rlink', href, target: '_blank', rel: 'noopener' }, 'This box on ChicagoBudget.com ↗'));
  body.replaceChildren(...parts);
  body.removeAttribute('aria-busy');
}

function splitBar(byGov, core) {
  const tot = Object.values(byGov).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const segs = core.govs.filter((g) => byGov[g.id] > 0);
  return el('div', { class: 'mix' },
    el('div', { class: 'mbar' }, segs.map((g) => el('i', { style: { flexGrow: byGov[g.id] / tot, background: COL[g.id] }, title: `${g.name}: ${money(byGov[g.id])}` }))),
    el('ul', { class: 'mkey' }, segs.map((g) => el('li', null, el('i', { style: { background: COL[g.id] } }), `${g.short} ${pct(byGov[g.id] / tot)}`))));
}

function mixBar(ty) {
  if (!ty) return null;
  let vals;
  if (typeof ty === 'string') vals = MIX.map(([k]) => (k[0] === ty ? 1 : 0));
  else vals = ty.map((v) => Math.max(0, v));
  const tot = vals.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  const segs = MIX.map(([k, label, color], i) => ({ k, label, color, v: vals[i] / tot })).filter((s) => s.v > 0.0005);
  return el('div', { class: 'mix' },
    el('h4', null, 'What it pays for'),
    el('div', { class: 'mbar', role: 'img', 'aria-label': segs.map((s) => `${s.label} ${pct(s.v)}`).join(', ') }, segs.map((s) => el('i', { style: { flexGrow: s.v, background: s.color } }))),
    el('ul', { class: 'mkey' }, segs.map((s) => el('li', null, el('i', { style: { background: s.color } }), `${s.label} ${pct(s.v)}`))));
}

function extras(x) {
  const out = [];
  const top = (obj, label) => {
    const rows = Object.entries(obj).filter(([, v]) => typeof v === 'number' && v > 0).sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((a, [, v]) => a + v, 0);
    if (rows.length < 2 || !tot) return null;
    return el('div', { class: 'facts' }, el('h4', null, label),
      el('ul', null, rows.slice(0, 4).map(([k, v]) => el('li', null, el('span', null, k), el('b', null, `${money(v)} · ${pct(v / tot)}`)))));
  };
  if (x.money_comes_from_cents) out.push(top(x.money_comes_from_cents, 'Money comes from'));
  if (x.program_areas_cents) out.push(top(x.program_areas_cents, 'Program areas'));
  const small = [];
  if (x.enrollment_2024_25) small.push(`${count(x.enrollment_2024_25)} students enrolled (2024-25)`);
  if (x.region) small.push(`${x.region}${x.park_number ? `, park ${x.park_number}` : ''}`);
  if (x.fte) small.push(`${count(x.fte)} full-time equivalents`);
  if (x.ward) small.push(`Ward ${x.ward}`);
  if (x.series) small.push(`Bond series ${x.series}`);
  if (x.principal_cents) small.push(`Principal ${money(x.principal_cents)} · interest ${money(x.interest_cents || 0)}`);
  if (x.final_maturity) small.push(`Final maturity ${x.final_maturity}`);
  if (x.coupon_percent) small.push(`Coupon ${x.coupon_percent}%`);
  if (x.contract) small.push(`Contract ${x.contract}`);
  if (x.status) small.push(`Status: ${x.status}`);
  if (small.length) out.push(el('ul', { class: 'smallfacts' }, small.map((s) => el('li', null, s))));
  if (x.pdf_url && /^https?:\/\//.test(x.pdf_url)) out.push(el('a', { class: 'rlink', href: x.pdf_url, target: '_blank', rel: 'noopener' }, 'Project document ↗'));
  return out.filter(Boolean);
}

function factLine(s, n) {
  const x = s.x || {};
  if (s.k === 'prior_year_budget' && typeof s.a === 'number' && s.a) {
    const ch = n.amount / s.a - 1;
    return [s.l || `${s.p} budget`, `${money(s.a)} · ${ch >= 0 ? '+' : ''}${pct(ch)} this year`];
  }
  if (s.k === 'pay_2025' && x.group) {
    const gp = x.group;
    const bits = [];
    if (gp.n_paid_2025) bits.push(`${count(gp.n_paid_2025)} people paid`);
    if (gp.total_2025) bits.push(`${money(gp.total_2025 * 100)} in all`);
    if (gp.overtime_2025) bits.push(`${money(gp.overtime_2025 * 100)} overtime`);
    if (gp.median_total_excl_retro_fullyear) bits.push(`median ${money(gp.median_total_excl_retro_fullyear * 100)}`);
    return [`2025 actual pay${gp.title ? `: ${titleCase(gp.title)}` : ''}`, bits.join(' · ') || 'See source'];
  }
  if (s.k === 'enrollment' && x.count) return [s.l || 'Students enrolled', count(x.count)];
  let label = s.l || titleCase(String(s.k || 'Fact').replace(/_/g, ' '));
  if (s.p && label === s.p) label = 'Paid so far, ' + label.replace(/^paid\s+/i, '');
  const per = s.p && !label.includes(s.p) && !label.includes(s.p.replace(/^paid\s+/i, '')) ? s.p : '';
  return [label, typeof s.a === 'number' ? money(s.a) + (per ? ` · ${per}` : '') : per];
}

const SECTION_ORDER = ['Paid so far', 'Last year', 'More facts'];

function facts(list, n, token) {
  list = [...list].sort((a, b) => SECTION_ORDER.indexOf(a.sec || 'More facts') - SECTION_ORDER.indexOf(b.sec || 'More facts'));
  const shown = list.slice(0, 6);
  const wrap = el('div', { class: 'facts' }, el('h4', null, 'More facts, not added into this box'));
  const ul = el('ul');
  const add = (s) => {
    const [label, value] = factLine(s, n);
    const li = el('li', null, el('span', null, label), value ? el('b', null, value) : null);
    const items = s.x && Array.isArray(s.x.items) ? s.x.items : null;
    if (items && items.length) {
      li.append(el('ol', { class: 'items' }, items.slice(0, 5).map((it) =>
        el('li', null, el('span', null, it.is_individual ? 'Individual (name hidden)' : it.vendor || 'Payment'), typeof it.amount === 'number' ? el('b', null, money(it.amount)) : null))));
    }
    if (Number.isInteger(s.s)) {
      const citation = el('div', { class: 'fact-source' });
      li.append(citation);
      D.sources().then((all) => {
        if (token === railToken) citation.replaceChildren(sourceLine(all[s.s]));
      });
    }
    ul.append(li);
  };
  shown.forEach(add);
  wrap.append(ul);
  if (list.length > shown.length) {
    const more = el('button', { type: 'button', class: 'linkbtn', onclick: () => { list.slice(6).forEach(add); more.remove(); } }, `Show ${list.length - shown.length} more`);
    wrap.append(more);
  }
  return wrap;
}

function sourceLine(src) {
  if (!src) return el('p', { class: 'fine' }, 'Source record not available');
  const label = src.name || src.doc || (src.dataset ? `Dataset ${src.dataset}` : 'Source');
  const where = [src.page ? `p. ${src.page}` : null, src.printed_page ? `printed p. ${src.printed_page}` : null].filter(Boolean).join(', ');
  const url = [src.url, src.url2, src.acfr_url].find((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  const text = label + (where ? ` (${where})` : '');
  return el('p', { class: 'src' }, url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text + ' ↗') : text);
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
