import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { scaleLog, scaleSqrt, scaleLinear } from 'd3-scale';
import { forceSimulation, forceX, forceY, forceCollide } from 'd3-force';
import { axisBottom } from 'd3-axis';
import { format } from 'd3-format';
import { select } from 'd3-selection';
import 'd3-transition';
import { median, sum } from 'd3-array';
import * as D from '../lib/data.js';
import { money, words, exact, pct, perHead, count } from '../lib/format.js';
import { COL, TINT, INK, el, showTip, moveTip, hideTip, reduceMotion, writeHash } from '../lib/ui.js';
import { renderRail } from './rail.js';

const PEOPLE_KINDS = new Set(['job_title', 'pay_rate', 'position', 'job_title_group']);
const VIEW_LABEL = { boxes: 'Boxes', swarm: 'Per student', parks: 'Per park', people: 'People', list: 'List' };

export function initAtlas(core) {
  const F = core.facts;
  const POP = core.meta.population;
  const reduce = reduceMotion();
  const GOV = Object.fromEntries(core.govs.map((g) => [g.id, g]));
  const PURP = Object.fromEntries(core.purposes.map((p) => [p.id, p]));
  const memberOf = new Map();
  for (const p of core.purposes) for (const m of p.members) memberOf.set(m, p.id);
  const schoolsById = new Map(core.schools.map((s) => [s[0], s]));
  const parksById = new Map(core.parks.map((p) => [p[0], p]));

  const root = document.getElementById('atlas');
  const tm = root.querySelector('.tm');
  const ribbon = root.querySelector('.ribbon');
  const railEl = root.querySelector('.rail');
  const negs = root.querySelector('.negs');
  const upBtn = root.querySelector('[data-up]');
  const viewsSeg = root.querySelector('[data-views]');
  const modeSeg = root.querySelector('[data-mode]');
  const status = root.querySelector('[data-status]');

  const ALL = { id: 'all', name: 'All three budgets', amount: F.total, virtual: true };
  const pnode = (pid) => ({ id: 'p:' + pid, name: PURP[pid].name, amount: PURP[pid].amount, virtual: true, purpose: pid });

  let mode = 'gov', cur = 'all', sel = null, view = 'boxes', token = 0;

  const nodeOf = (id) => (id === 'all' ? ALL : id.startsWith('p:') ? pnode(id.slice(2)) : D.get(id));
  const govOf = (id) => (id === 'all' || id.startsWith('p:') ? null : id.startsWith('city-twice') ? 'city-twice' : id.split('.')[0]);
  const linkGov = (id) => (id.startsWith('city-twice') ? 'city' : id.split('.')[0]);

  function kidsOf(id) {
    if (id === 'all') {
      return mode === 'purpose'
        ? [...core.purposes].sort((a, b) => b.amount - a.amount).map((p) => pnode(p.id))
        : core.govs.map((g) => D.get(g.id));
    }
    if (id.startsWith('p:')) return PURP[id.slice(2)].members.map((m) => D.get(m)).filter(Boolean).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return D.children(id);
  }

  function chainOf(id) {
    if (id === 'all') return [ALL];
    if (id.startsWith('p:')) return [ALL, pnode(id.slice(2))];
    const p = D.path(id);
    if (id.startsWith('city-twice')) return p;
    if (mode === 'purpose') {
      const i = p.findIndex((n) => memberOf.has(n.id));
      if (i >= 0) return [ALL, pnode(memberOf.get(p[i].id)), ...p.slice(i)];
    }
    return [ALL, ...p];
  }
  const parentOf = (id) => {
    const c = chainOf(id);
    return c.length > 1 ? c[c.length - 2].id : null;
  };

  /* ---------------------------------------------------------------- views available here */
  function viewsFor(id) {
    const v = ['boxes'];
    if (!id.startsWith('p:') && id !== 'all' && D.isTreeLoaded()) {
      if (D.descendants(id, 'school', 4).length >= 8) v.push('swarm');
      if (D.descendants(id, 'park', 3).length >= 8) v.push('parks');
    }
    const kids = kidsOf(id) || [];
    if (kids.filter((k) => PEOPLE_KINDS.has(k.kind)).length >= 2) v.push('people');
    v.push('list');
    return v;
  }

  /* ---------------------------------------------------------------- level bars */
  function renderRibbon() {
    const chain = chainOf(cur);
    const rows = [];
    if (chain[0].id === 'all') {
      rows.push({ parent: ALL, kids: kidsOf('all'), sel: chain[1] || null });
      for (let i = 1; i < chain.length; i++) if (chain[i + 1]) rows.push({ parent: chain[i], kids: kidsOf(chain[i].id) || [], sel: chain[i + 1] });
    } else {
      for (let i = 0; i < chain.length; i++) if (chain[i + 1]) rows.push({ parent: chain[i], kids: kidsOf(chain[i].id) || [], sel: chain[i + 1] });
      if (!rows.length) rows.push({ parent: chain[0], kids: kidsOf(chain[0].id) || [], sel: null, memo: true });
    }
    ribbon.replaceChildren(...rows.map((L) => {
      const pos = L.kids.filter((k) => k.amount > 0);
      const tot = sum(pos, (k) => k.amount) || 1;
      const bar = el('div', { class: 'rbar' }, pos.map((k) => {
        const isSel = L.sel && k.id === L.sel.id;
        const g = govOf(k.id);
        const share = k.amount / tot;
        return el('button', {
          type: 'button', class: isSel ? 'sel' : '',
          style: { flexGrow: share, flexBasis: 0, background: isSel ? (g ? COL[g === 'city-twice' ? 'twice' : g] : INK) : null },
          'aria-label': `${k.name}, ${words(k.amount)}, ${pct(share)} of ${L.parent.name}${isSel ? ', current' : ''}`,
          onpointerenter: (ev) => showTip(ev, [['v', words(k.amount)], ['n', k.name], ['m', `${pct(share)} of ${L.parent.name}`, g ? COL[g === 'city-twice' ? 'twice' : g] : INK]]),
          onpointermove: moveTip, onpointerleave: hideTip,
          onclick: () => { hideTip(); if (!isSel) go(k.id, 'jump'); },
        });
      }));
      const selShare = L.sel ? L.sel.amount / tot : 0;
      return el('div', { class: 'rrow' },
        el('button', { class: 'rl', type: 'button', title: `Go to ${L.parent.name}`, onclick: () => go(L.parent.id, 'out') }, L.parent.name),
        bar,
        el('div', { class: 'rv' }, L.sel ? [el('b', null, L.sel.name), el('span', null, `  ${money(L.sel.amount)} · ${pct(selShare)}`)] : el('span', null, L.memo ? 'Not part of any total' : 'Pick a box')));
    }));
  }

  /* ---------------------------------------------------------------- boxes (zooming treemap) */
  function layoutTiles(id, w, h) {
    const kids = (kidsOf(id) || []).filter((k) => k.amount > 0);
    const r = hierarchy({ children: kids.map((k) => ({ k })) }).sum((d) => (d.k ? d.k.amount : 0)).sort((a, b) => b.value - a.value);
    treemap().tile(treemapSquarify.ratio(1.3)).size([w, h]).paddingInner(3).round(true)(r);
    return r.leaves().map((l) => ({ k: l.data.k, x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0, share: l.value / r.value }));
  }

  function tileFill(k) {
    const g = govOf(k.id);
    return TINT[g] || TINT.all;
  }

  function makeTile(t, parent) {
    const k = t.k, [base, hover] = tileFill(k);
    const leaf = !k.virtual && k.leaf;
    const tile = el('div', {
      class: 'tile' + (leaf ? ' leaf' : ''), role: 'button', tabindex: 0,
      'aria-label': `${k.name}, ${words(k.amount)}, ${money(k.amount)}, ${pct(t.share)} of this box${leaf ? '' : '. Opens'}`,
      style: { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px', background: base },
      'data-id': k.id,
    });
    const g = govOf(k.id);
    tile.addEventListener('pointerenter', (ev) => {
      tile.style.background = hover;
      showTip(ev, [['v', words(k.amount)], ['n', k.name], ['m', `${pct(t.share)} of ${parent.name}`, g ? COL[g === 'city-twice' ? 'twice' : g] : INK],
        ['m', leaf ? 'The data stops here' : Array.isArray(k.kids) && k.kids.length ? `${count(k.kids.length)} boxes inside` : 'Click to open']]);
    });
    tile.addEventListener('pointermove', moveTip);
    tile.addEventListener('pointerleave', () => { tile.style.background = base; hideTip(); });
    const act = () => { hideTip(); if (leaf) select_(k.id, tile); else go(k.id, 'in', t); };
    tile.addEventListener('click', act);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
      if (e.key === 'Backspace' || e.key === 'Escape') { e.preventDefault(); up(); }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); moveFocus(tile, e.key); }
    });
    if (t.w > 64 && t.h > 30) {
      tile.append(el('div', { class: 'tn' }, k.name));
      if (t.h > 58 && t.w > 76) tile.append(el('div', { class: 'ta' }, money(k.amount)));
      if (t.h > 82 && t.w > 96) tile.append(el('div', { class: 'ts' }, pct(t.share) + ' of this box'));
      if (k.virtual && k.purpose && t.h > 110 && t.w > 120) {
        const by = PURP[k.purpose].byGov;
        tile.append(el('div', { class: 'gsplit', title: 'Split by government' },
          ['city', 'cps', 'parks'].filter((gid) => by[gid] > 0).map((gid) => el('i', { style: { flexGrow: by[gid], background: COL[gid] } }))));
      }
    }
    return tile;
  }

  function moveFocus(from, key) {
    const tiles = [...tm.querySelectorAll('.layer:last-child .tile')];
    const r0 = from.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bestD = Infinity;
    for (const t of tiles) {
      if (t === from) continue;
      const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      const ok = key === 'ArrowRight' ? dx > 4 : key === 'ArrowLeft' ? dx < -4 : key === 'ArrowDown' ? dy > 4 : dy < -4;
      if (!ok) continue;
      const d = Math.hypot(dx, dy) + (key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx)) * 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) best.focus();
  }

  function renderBoxes(anim, origin) {
    const w = tm.clientWidth, h = tm.clientHeight, parent = nodeOf(cur);
    const tiles = layoutTiles(cur, w, h);
    const old = [...tm.children];
    const layer = el('div', { class: 'layer' }, tiles.map((t) => makeTile(t, parent)));
    if (!tiles.length) layer.append(el('div', { class: 'empty' }, 'Nothing above zero inside this box. See the list for the amounts that subtract.'));
    tm.appendChild(layer);
    const ease = 'transform .62s cubic-bezier(.2,.75,.15,1), opacity .42s ease';
    const run = (fromT, oldT) => {
      layer.style.transformOrigin = '0 0'; layer.style.transform = fromT; layer.style.opacity = '0';
      for (const o of old) { o.style.transformOrigin = '0 0'; o.style.transition = ease; o.style.transform = oldT; o.style.opacity = '0'; }
      requestAnimationFrame(() => requestAnimationFrame(() => { layer.style.transition = ease; layer.style.transform = 'none'; layer.style.opacity = '1'; }));
    };
    if (!reduce && origin && anim === 'in') {
      const sx = origin.w / w, sy = origin.h / h;
      run(`translate(${origin.x}px,${origin.y}px) scale(${sx},${sy})`, `scale(${1 / sx},${1 / sy}) translate(${-origin.x}px,${-origin.y}px)`);
    } else if (!reduce && origin && anim === 'out') {
      const sx = origin.w / w, sy = origin.h / h;
      run(`scale(${1 / sx},${1 / sy}) translate(${-origin.x}px,${-origin.y}px)`, `translate(${origin.x}px,${origin.y}px) scale(${sx},${sy})`);
    } else if (!reduce && old.length) {
      run('scale(.985)', 'none');
    }
    setTimeout(() => old.forEach((o) => o.remove()), reduce ? 0 : 680);
    renderNegatives();
  }

  function renderNegatives() {
    const list = (kidsOf(cur) || []).filter((k) => k.amount < 0);
    negs.replaceChildren();
    if (!list.length) return;
    negs.append('Also inside, subtracting money: ');
    list.slice(0, 3).forEach((k, i) => {
      negs.append(el('button', { type: 'button', class: 'linkbtn', onclick: () => select_(k.id) }, `${k.name} (${money(k.amount)})`));
      if (i < Math.min(3, list.length) - 1) negs.append(', ');
    });
    if (list.length > 3) negs.append(` and ${list.length - 3} more in the list view.`);
  }

  /* ---------------------------------------------------------------- per student (schools) */
  function renderSwarm() {
    tm.replaceChildren();
    negs.replaceChildren();
    const w = tm.clientWidth, h = tm.clientHeight;
    const data = D.descendants(cur, 'school', 4).map((k) => ({ k, s: schoolsById.get(k.id) })).filter((d) => d.s && d.s[3])
      .map((d) => ({ ...d, pps: d.k.amount / 100 / d.s[3], enr: d.s[3], grp: d.s[4] }));
    const groups = [...new Set(data.map((d) => d.grp))];
    const lanes = groups.length > 1 ? groups : [null];
    const svg = select(tm).append('svg').attr('width', w).attr('height', h).attr('role', 'img')
      .attr('aria-label', `${data.length} schools by budget per enrolled student`);
    const lo = Math.max(1500, Math.min(...data.map((d) => d.pps)) * 0.9), hi = Math.max(...data.map((d) => d.pps)) * 1.1;
    const x = scaleLog().domain([lo, hi]).range([46, w - 26]);
    const r = scaleSqrt().domain([0, Math.max(...data.map((d) => d.enr))]).range([2.4, data.length > 200 ? 9 : 13]);
    const laneH = (h - 60) / lanes.length;
    lanes.forEach((g, li) => {
      const yc = 30 + laneH * li + laneH / 2;
      const pts = data.filter((d) => g === null || d.grp === g);
      for (const d of pts) { d.x = x(d.pps); d.y = yc; d.r = r(d.enr); }
      const sm = forceSimulation(pts).force('x', forceX((d) => x(d.pps)).strength(1)).force('y', forceY(yc).strength(0.07)).force('c', forceCollide((d) => d.r + 1)).stop();
      for (let i = 0; i < 200; i++) sm.tick();
      if (g) svg.append('text').attr('x', 46).attr('y', 30 + laneH * li + 16).attr('class', 'lane').text(g === 'charter' ? `Charter and contract schools (${pts.length})` : `District-run schools (${pts.length})`);
    });
    const ticks = [1000, 2500, 5000, 10000, 20000, 40000, 80000, 160000].filter((v) => v >= lo && v <= hi);
    const ax = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 30})`)
      .call(axisBottom(x).tickValues(ticks).tickFormat(format('$,.0f')).tickSize(-h + 54));
    ax.select('.domain').remove();
    const med = median(data, (d) => d.pps);
    svg.append('line').attr('x1', x(med)).attr('x2', x(med)).attr('y1', 22).attr('y2', h - 30).attr('stroke', INK).attr('stroke-width', 1);
    const medLab = svg.append('text').attr('x', x(med) + 6).attr('y', 18).attr('class', 'medlab').text(`Median ${exact(med * 100).replace(/\.\d\d$/, '')} per student`);
    svg.append('g').selectAll('circle').data(data).join('circle')
      .attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', reduce ? (d) => d.r : 0)
      .attr('fill', COL.cps).attr('stroke', '#fff').attr('stroke-width', 1.4).style('cursor', 'pointer')
      .on('pointerenter', (ev, d) => { select(ev.currentTarget).attr('stroke', INK); showTip(ev, [['v', `${exact(d.pps * 100).replace(/\.\d\d$/, '')} per student`], ['n', d.k.name], ['m', `${words(d.k.amount)} for ${count(d.enr)} students`, COL.cps]]); })
      .on('pointermove', moveTip).on('pointerleave', (ev) => { select(ev.currentTarget).attr('stroke', '#fff'); hideTip(); })
      .on('click', (ev, d) => { hideTip(); select_(d.k.id); })
      .call((s) => { if (!reduce) s.transition().duration(600).delay((d, i) => Math.min(i * 2, 600)).attr('r', (d) => d.r); });
    medLab.raise();
    const missing = D.descendants(cur, 'school', 4).length - data.length;
    negs.replaceChildren(`Budget per enrolled student, log scale. Circle size is enrollment. ${missing ? `${missing} schools without an enrollment count are not shown. ` : ''}A school’s own budget leaves out citywide costs such as buses, buildings and pensions.`);
  }

  /* ---------------------------------------------------------------- per park */
  function renderParks() {
    tm.replaceChildren();
    const w = tm.clientWidth, h = tm.clientHeight;
    const data = D.descendants(cur, 'park', 3).map((k) => ({ k, p: parksById.get(k.id) })).map((d) => ({ ...d, region: d.p ? d.p[3] : 'Parks' }));
    const regions = [...new Set(data.map((d) => d.region))].sort();
    const svg = select(tm).append('svg').attr('width', w).attr('height', h).attr('role', 'img').attr('aria-label', `${data.length} parks by 2026 budget`);
    const x = scaleLinear().domain([0, Math.max(...data.map((d) => d.k.amount)) * 1.04]).range([46, w - 26]).nice();
    const laneH = (h - 60) / regions.length;
    regions.forEach((g, li) => {
      const yc = 30 + laneH * li + laneH / 2;
      const pts = data.filter((d) => d.region === g);
      for (const d of pts) { d.x = x(d.k.amount); d.y = yc; }
      const sm = forceSimulation(pts).force('x', forceX((d) => x(d.k.amount)).strength(1)).force('y', forceY(yc).strength(0.08)).force('c', forceCollide(5.6)).stop();
      for (let i = 0; i < 160; i++) sm.tick();
      svg.append('text').attr('x', 46).attr('y', 30 + laneH * li + 16).attr('class', 'lane').text(`${g} (${pts.length} parks) · median ${money(median(pts, (d) => d.k.amount))}`);
    });
    const ax = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 30})`).call(axisBottom(x).ticks(6).tickFormat((v) => money(v)).tickSize(-h + 54));
    ax.select('.domain').remove();
    svg.append('g').selectAll('circle').data(data).join('circle').attr('cx', (d) => d.x).attr('cy', (d) => d.y).attr('r', 4.6)
      .attr('fill', COL.parks).attr('stroke', '#fff').attr('stroke-width', 1.2).style('cursor', 'pointer')
      .on('pointerenter', (ev, d) => { select(ev.currentTarget).attr('stroke', INK); showTip(ev, [['v', words(d.k.amount)], ['n', d.k.name], ['m', d.region, COL.parks]]); })
      .on('pointermove', moveTip).on('pointerleave', (ev) => { select(ev.currentTarget).attr('stroke', '#fff'); hideTip(); })
      .on('click', (ev, d) => { hideTip(); select_(d.k.id); });
    negs.replaceChildren('Each dot is one park’s own 2026 budget. Districtwide crews, programs and venues are budgeted separately.');
  }

  /* ---------------------------------------------------------------- people (budgeted positions) */
  async function renderPeople(t) {
    tm.replaceChildren(el('div', { class: 'loading' }, 'Counting positions…'));
    const kids = (kidsOf(cur) || []).filter((k) => k.amount > 0);
    const det = await Promise.all(kids.map((k) => D.details(k.id).then((d) => ({ k, d }))));
    if (t !== token) return;
    const rows = det.map(({ k, d }) => ({ k, pos: d.pos || 0, unit: d.u, c: d.c })).filter((r) => r.pos > 0).sort((a, b) => b.pos - a.pos);
    const total = sum(rows, (r) => r.pos);
    const per = total > 2400 ? 20 : total > 1200 ? 10 : total > 600 ? 5 : 1;
    const g = govOf(cur);
    const shown = rows.slice(0, 16);
    const wrap = el('div', { class: 'people' },
      el('p', { class: 'pnote' }, `${count(total)} budgeted positions in ${rows.length} job titles. Each dot is ${per === 1 ? 'one position' : `${per} positions`}.`),
      shown.map((r) => el('div', { class: 'prow', onclick: () => (r.k.leaf ? select_(r.k.id) : go(r.k.id, 'jump')), role: 'button', tabindex: 0,
        onkeydown: (e) => { if (e.key === 'Enter') (r.k.leaf ? select_(r.k.id) : go(r.k.id, 'jump')); } },
        el('div', { class: 'plab' }, el('b', null, r.k.name), el('span', null, `${count(r.pos)} · avg ${money(r.k.amount / r.pos)}`)),
        el('div', { class: 'pdots' }, Array.from({ length: Math.max(1, Math.round(r.pos / per)) }, () => el('i', { style: { background: COL[g] || COL.city } }))))),
      rows.length > shown.length ? el('p', { class: 'pnote' }, `${rows.length - shown.length} smaller titles are in the list view.`) : null);
    tm.replaceChildren(wrap);
    negs.replaceChildren('Positions are budgeted jobs and full-time equivalents, not named people. Average is the box’s budget divided by its positions.');
  }

  /* ---------------------------------------------------------------- list (the table twin) */
  function renderList() {
    const kids = kidsOf(cur) || [];
    const tot = sum(kids.filter((k) => k.amount > 0), (k) => k.amount) || 1;
    const tbl = el('table', { class: 'list' },
      el('thead', null, el('tr', null, el('th', null, 'Box'), el('th', { class: 'n' }, 'Amount'), el('th', { class: 'n' }, 'Share'), el('th', null, ''))),
      el('tbody', null, kids.map((k) => el('tr', null,
        el('td', null, el('button', { type: 'button', class: 'linkbtn', onclick: () => (!k.virtual && k.leaf ? select_(k.id) : go(k.id, 'jump')) }, k.name)),
        el('td', { class: 'n' }, exact(k.amount)),
        el('td', { class: 'n' }, k.amount > 0 ? pct(k.amount / tot) : '–'),
        el('td', { class: 'bar' }, k.amount > 0 ? el('i', { style: { width: Math.max(1, (100 * k.amount) / tot) + '%', background: COL[govOf(k.id)] || INK } }) : null)))));
    tm.replaceChildren(el('div', { class: 'listwrap' }, tbl));
    negs.replaceChildren();
  }

  /* ---------------------------------------------------------------- selection and navigation */
  function select_(id, tile) {
    sel = id;
    tm.querySelectorAll('.tile.selected').forEach((t) => t.classList.remove('selected'));
    const t = tile || tm.querySelector(`.layer:last-child .tile[data-id="${CSS.escape(id)}"]`);
    if (t) t.classList.add('selected');
    renderRail(railEl, { id, nodeOf, parentOf, govOf, linkGov, core, PURP, GOV, onOpen: (x) => go(x, 'jump') });
    writeHash({ box: id, by: mode === 'purpose' ? 'purpose' : null, view: view !== 'boxes' ? view : null });
  }

  function setStatus(text) { status.textContent = text || ''; }

  async function go(id, anim = 'jump', origin = null) {
    const t = ++token;
    hideTip();
    let target = id;
    if (target !== 'all' && !target.startsWith('p:')) {
      if (!D.get(target) || D.children(target) === null) {
        setStatus('Loading every box…');
        try { await D.ensure(target); } catch { setStatus('Could not load the budget boxes. Check your connection and try again.'); return; }
        if (t !== token) return;
        setStatus('');
      }
      if (!D.get(target)) { setStatus('That box is not in this budget.'); target = 'all'; }
    }
    const n = nodeOf(target);
    let nextSel = null;
    if (n && !n.virtual && n.leaf) { nextSel = target; target = parentOf(target) || 'all'; }
    let outRect = null;
    if (anim === 'out' && cur !== target) {
      const chain = chainOf(cur);
      const i = chain.findIndex((c) => c.id === target);
      if (i >= 0 && chain[i + 1]) outRect = layoutTiles(target, tm.clientWidth, tm.clientHeight).find((tl) => tl.k.id === chain[i + 1].id) || null;
    }
    cur = target;
    sel = nextSel;
    const vs = viewsFor(cur);
    if (!vs.includes(view)) view = 'boxes';
    viewsSeg.replaceChildren(...vs.map((v) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(v === view), onclick: () => { view = v; go(cur, 'none'); } }, VIEW_LABEL[v])));
    upBtn.disabled = cur === 'all';
    renderRibbon();
    if (view === 'swarm') renderSwarm();
    else if (view === 'parks') renderParks();
    else if (view === 'people') renderPeople(t);
    else if (view === 'list') renderList();
    else renderBoxes(anim, anim === 'out' ? outRect : origin);
    const focusId = sel || cur;
    renderRail(railEl, { id: focusId, nodeOf, parentOf, govOf, linkGov, core, PURP, GOV, onOpen: (x) => go(x, 'jump') });
    if (sel) requestAnimationFrame(() => { const tl = tm.querySelector(`.layer:last-child .tile[data-id="${CSS.escape(sel)}"]`); if (tl) tl.classList.add('selected'); });
    writeHash({ box: focusId === 'all' ? null : focusId, by: mode === 'purpose' ? 'purpose' : null, view: view !== 'boxes' ? view : null });
  }

  function up() { if (cur !== 'all') go(parentOf(cur) || 'all', 'out'); }
  upBtn.addEventListener('click', up);

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    if (cur.startsWith('p:') && m === 'gov') cur = 'all';
    go(sel || cur, 'none');
  }
  modeSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ---------------------------------------------------------------- search */
  const q = root.querySelector('input[type=search]');
  const results = root.querySelector('.results');
  let act = -1;
  function contextOf(n) {
    const p = D.path(n.id).slice(0, -1).map((x) => x.name);
    if (p.length > 3) return [p[0], p[1], '…', p[p.length - 1]].join(' › ');
    return p.join(' › ');
  }
  async function runSearch() {
    const term = q.value.trim();
    act = -1;
    if (term.length < 2) { results.classList.remove('on'); results.replaceChildren(); return; }
    if (!D.isTreeLoaded()) {
      results.replaceChildren(el('div', { class: 'empty' }, `Loading all ${count(core.meta.nodes)} boxes…`));
      results.classList.add('on');
      try { await D.loadTree(); }
      catch {
        if (q.value.trim() === term) results.replaceChildren(el('div', { class: 'empty' }, 'Could not load the budget boxes. Check your connection and try again.'));
        return;
      }
      if (q.value.trim() !== term) return;
    }
    const hits = D.search(term, 9);
    results.replaceChildren(...(hits.length ? hits.map((h) => el('button', { type: 'button', role: 'option', onclick: () => pick(h.id) },
      el('span', { class: 'rn' }, h.name), el('span', { class: 'ra' }, money(h.amount)), el('span', { class: 'rp' }, contextOf(h)))) :
      [el('div', { class: 'empty' }, `No box is named “${term}”. Try a department, a school, a park or a job title.`)]));
    results.classList.add('on');
  }
  function pick(id) { results.classList.remove('on'); q.blur(); go(id, 'jump'); }
  q.addEventListener('focus', () => D.loadTree().catch(() => {}));
  q.addEventListener('input', runSearch);
  q.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('act', i === act));
      items[act].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && items.length) { e.preventDefault(); items[Math.max(0, act)].click(); }
    if (e.key === 'Escape') { results.classList.remove('on'); q.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) results.classList.remove('on'); });

  let rz;
  new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (view === 'boxes') renderBoxes('none'); else if (view !== 'people') go(cur, 'none'); }, 160); }).observe(tm);

  return {
    open(id, opts = {}) {
      if (opts.by && opts.by !== mode) { mode = opts.by; modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode))); }
      if (opts.view) view = opts.view;
      if (opts.scroll !== false) document.getElementById('explore').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return go(id, 'jump');
    },
    focusSearch() {
      document.getElementById('explore').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => q.focus(), reduce ? 0 : 420);
    },
    init(state) {
      if (state.by === 'purpose') { mode = 'purpose'; modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode))); }
      if (state.view) view = state.view;
      return go(state.box || 'all', 'none');
    },
  };
}
