import { select } from 'd3-selection';
import 'd3-transition';
import { scaleLog } from 'd3-scale';
import { forceSimulation, forceX, forceY, forceCollide } from 'd3-force';
import { median, max } from 'd3-array';
import * as D from '../lib/data.js';
import { money, words, pct, perHead, count, dollars, oneIn } from '../lib/format.js';
import { COL, INK, el, showTip, moveTip, hideTip, reduceMotion, onceVisible, star } from '../lib/ui.js';
import { initGrid } from './grid.js';

/** Six notable numbers. Every card opens the explorer at the box it is about. */
export function initStories(core, atlas) {
  const F = core.facts;
  const POP = core.meta.population;
  const reduce = reduceMotion();
  const wrap = document.getElementById('stories');
  const open = (id, opts) => (e) => { e.preventDefault(); atlas.open(id, opts); };
  const cta = (label, id, opts) => el('a', { class: 'cta', href: id.startsWith('p:') ? `/methods#groups` : `/${id.split('.')[0] === 'city-twice' ? 'city' : id.split('.')[0]}/box/${encodeURIComponent(id)}/`, onclick: open(id, opts) }, label + ' →');
  const card = (cls, ...kids) => el('article', { class: 'card ' + cls }, ...kids);
  const kicker = (t) => el('p', { class: 'ck' }, star(), t);

  /* 1. one in four ------------------------------------------------------------ */
  const gridBox = el('div', { class: 'gridbox' });
  const c1 = card('wide',
    kicker('Pensions & debt'),
    el('h3', null, `One in ${oneIn(F.past_share)} dollars pays for the past`),
    el('p', { class: 'cd' }, `Of the ${money(F.total)} the three governments budget for 2026, ${words(F.past)} goes into pension funds and to paying back loans.`),
    gridBox,
    cta('Open pensions and loans in the explorer', 'p:pensions', { by: 'purpose' }));

  /* 2. pension funds ----------------------------------------------------------- */
  const funds = [...core.pensions].sort((a, b) => a.funded - b.funded);
  const bars = el('div', { class: 'fbars' }, funds.map((p) => el('div', {
    class: 'frow', role: 'button', tabindex: 0,
    onclick: open(p.id), onkeydown: (e) => { if (e.key === 'Enter') atlas.open(p.id); },
    onpointerenter: (ev) => showTip(ev, [['v', `${Math.round(p.funded * 100)}¢ per $1`], ['n', `${p.fund} pension fund`], ['m', `${words(p.unfunded)} short · ${money(p.payment)} paid in 2026`, COL.past]]),
    onpointermove: moveTip, onpointerleave: hideTip,
  }, el('span', null, p.fund), el('div', { class: 'ftrack' }, el('i', { 'data-w': p.funded * 100 + '%' }), el('em')), el('b', null, Math.round(p.funded * 100) + '¢'))));
  const c2 = card('',
    kicker('City pension funds'),
    el('h3', null, `${Math.round(funds[0].funded * 100)} to ${Math.round(funds[funds.length - 1].funded * 100)} cents saved for every dollar promised`),
    el('p', { class: 'cd' }, `The City’s four funds are ${words(F.unfunded_city_pensions)} short, about ${perHead(F.unfunded_city_pensions, POP)} for every Chicagoan.`),
    bars, el('p', { class: 'fine' }, `The line at the end of each track is $1 saved for every $1 owed. Actuarial value as of ${funds[0].as_of || 'the latest valuation'}.`),
    cta('Open the pension funds', 'city.retirement'));
  onceVisible(bars, () => bars.querySelectorAll('i[data-w]').forEach((i) => { i.style.width = i.dataset.w; }));

  /* 3. police ------------------------------------------------------------------ */
  const pid = 'city.public-safety.chicago-police-department';
  const pk = (D.children(pid) || []).filter((k) => k.amount > 0);
  const officer = core.jobs.find((j) => j.title === 'Police Officer');
  const pmax = max(pk, (k) => k.amount);
  const c3 = card('',
    kicker('Police'),
    el('h3', null, `${words(F.police)}, one in ${oneIn(F.police_share_city)} City dollars`),
    el('p', { class: 'cd' }, `The biggest single department. ${officer ? `${count(officer.count)} police officers are budgeted at an average ${money(officer.amount / officer.count)}, and ` : ''}${money(F.police_overtime)} is set aside for overtime.`),
    el('ul', { class: 'hbars' }, pk.slice(0, 6).map((k) => el('li', {
      onpointerenter: (ev) => showTip(ev, [['v', words(k.amount)], ['n', k.name], ['m', `${pct(k.amount / F.police)} of the Police budget`, COL.city]]),
      onpointermove: moveTip, onpointerleave: hideTip,
    }, el('span', null, k.name), el('div', null, el('i', { style: { width: (100 * k.amount) / pmax + '%', background: COL.city } })), el('b', null, money(k.amount))))),
    cta('Open the Police Department', pid));

  /* 4. schools ----------------------------------------------------------------- */
  const sw = el('div', { class: 'miniswarm' });
  const c4 = card('',
    kicker('Schools'),
    el('h3', null, `${dollars(F.cps_per_student)} per CPS student`),
    el('p', { class: 'cd' }, `With every cost in, from buses to pensions. Inside a school’s own budget the median is ${dollars(F.school_median_per_student)} per student. Each dot is a school.`),
    sw,
    cta('See every school per student', 'cps.schools', { view: 'swarm' }));
  onceVisible(sw, () => drawSchools(sw, core, reduce), 0.2);

  /* 5. payees ------------------------------------------------------------------ */
  const pv = core.vendors2026.slice(0, 6);
  const vmax = max(pv, (v) => v.amount);
  const nice = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bFd\b/, 'Fund').replace(/\bA & B\b/, 'A&B').replace(/\bU S\b/, 'U.S.').replace(/\bN A\b/, 'N.A.').replace(/\bLlc\b/g, 'LLC');
  const c5 = card('',
    kicker('Checks written'),
    el('h3', null, /pension/i.test(pv[0].name) ? 'The City’s biggest payee this year is its own pension fund' : 'The City’s biggest payees this year'),
    el('p', { class: 'cd' }, `Payments made ${(core.meta.periods.city_2026_to_0928 || {}).label || 'so far this year'}. Payments to individuals are pooled and not shown.`),
    el('ul', { class: 'hbars' }, pv.map((v) => el('li', {
      onpointerenter: (ev) => showTip(ev, [['v', words(v.amount)], ['n', nice(v.name)], ['m', `2025, full year: ${money(v.amount_2025)}`, COL.city]]),
      onpointermove: moveTip, onpointerleave: hideTip,
    }, el('span', null, nice(v.name)), el('div', null, el('i', { style: { width: (100 * v.amount) / vmax + '%', background: COL.city } })), el('b', null, money(v.amount))))),
    el('p', { class: 'fine' }, 'Payments are actual checks, not the budget. Some pay pensions, health plans and bond trustees.'));

  /* 6. counted twice ------------------------------------------------------------ */
  const rec = [['City budget, net', F.gross_city - F.counted_twice + F.obm_adjustment, COL.city], ['Counted twice', F.counted_twice, '#9DB6D3'], ['Adjustment no line explains', -F.obm_adjustment, '#C3CAD2']];
  const c6 = card('wide twice',
    el('div', null,
      kicker('Counted twice'),
      el('h3', null, `${words(F.counted_twice)} moves between City funds`),
      el('p', { class: 'cd' }, `Pension money and reimbursements pass from one City fund to another, so the ordinance’s gross ${words(F.gross_city)} counts them twice. This site uses the net ${words(F.gross_city - F.counted_twice + F.obm_adjustment)}.`),
      cta('Open the money counted twice', 'city-twice')),
    el('div', { class: 'recon' },
      el('div', { class: 'rbar2', role: 'img', 'aria-label': rec.map(([n, v]) => `${n} ${money(v)}`).join(', ') }, rec.map(([n, v, c]) => el('i', { style: { flexGrow: v, background: c }, title: `${n}: ${money(v)}` }))),
      el('ul', { class: 'rkey' }, rec.map(([n, v, c]) => el('li', null, el('i', { style: { background: c } }), el('span', null, n), el('b', null, money(v)))),
        el('li', { class: 'tot' }, el('span', null, 'Gross ordinance'), el('b', null, money(F.gross_city))))));

  wrap.replaceChildren(c1, c2, c3, c4, c5, c6);
  initGrid(gridBox, core);
}

function drawSchools(node, core, reduce) {
  const w = node.clientWidth, h = 150;
  const data = core.schools.filter((s) => s[3]).map((s) => ({ name: s[1], pps: s[2] / 100 / s[3], enr: s[3] }));
  const x = scaleLog().domain([2500, 80000]).range([6, w - 6]).clamp(true);
  for (const d of data) { d.x = x(d.pps); d.y = h / 2; }
  const sim = forceSimulation(data).force('x', forceX((d) => x(d.pps)).strength(1)).force('y', forceY(h / 2).strength(0.09)).force('c', forceCollide(2.3)).stop();
  for (let i = 0; i < 160; i++) sim.tick();
  const svg = select(node).append('svg').attr('width', w).attr('height', h + 22).attr('role', 'img').attr('aria-label', `${data.length} schools by budget per student`);
  const med = median(data, (d) => d.pps);
  svg.append('line').attr('x1', x(med)).attr('x2', x(med)).attr('y1', 4).attr('y2', h).attr('stroke', INK);
  svg.append('g').selectAll('circle').data(data).join('circle').attr('cx', (d) => d.x).attr('cy', (d) => Math.max(4, Math.min(h - 4, d.y)))
    .attr('r', reduce ? 2 : 0).attr('fill', COL.cps)
    .on('pointerenter', (ev, d) => showTip(ev, [['v', `${dollars(d.pps)} per student`], ['n', d.name], ['m', `${count(d.enr)} students`, COL.cps]]))
    .on('pointermove', moveTip).on('pointerleave', hideTip)
    .call((s) => { if (!reduce) s.transition().duration(500).delay((d, i) => i * 1.2).attr('r', 2); });
  for (const v of [5000, 10000, 20000, 40000]) svg.append('text').attr('x', x(v)).attr('y', h + 16).attr('text-anchor', 'middle').attr('class', 'tick').text('$' + v / 1000 + 'K');
}
