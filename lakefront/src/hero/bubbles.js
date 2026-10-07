import { forceSimulation, forceX, forceY, forceCollide } from 'd3-force';
import { select } from 'd3-selection';
import 'd3-transition';
import { sum, max, shuffle } from 'd3-array';
import { timer } from 'd3-timer';
import { easeCubicOut } from 'd3-ease';
import { money, words, pct, perHead, exact, oneIn } from '../lib/format.js';
import { COL, INK, el, showTip, moveTip, hideTip, textOn, reduceMotion, star, writeHash } from '../lib/ui.js';

const isPast = (d) => d.purpose === 'pensions' || d.purpose === 'debt';

/**
 * The hero: 103 programs as circles that regroup by government, purpose, or how much pays for the past.
 * onOpen(id) opens a box in the explorer.
 */
export function initHero(core, { onOpen, lens: startLens }) {
  const field = document.getElementById('field');
  const svg = select(field).append('svg').attr('role', 'img').attr('aria-label', `Bubble chart of ${core.bubbles.length} programs in Chicago’s 2026 budgets, sized by budget`);
  const gStripe = svg.append('g').attr('aria-hidden', 'true');
  const gB = svg.append('g');
  const gAnno = svg.append('g').attr('aria-hidden', 'true');
  const reduce = reduceMotion();
  const GOV = Object.fromEntries(core.govs.map((g) => [g.id, g]));
  const PURP = Object.fromEntries(core.purposes.map((p) => [p.id, p]));
  const POP = core.meta.population;
  const F = core.facts;
  const nodes = core.bubbles.map((b, i) => ({ ...b, i, r: 0, rT: 0, x: 0, y: 0 }));

  const policeFund = core.pensions.find((p) => p.fund === 'Police');
  const cents = (r) => `${Math.round(r * 100)}¢`;
  const cpsCompare = F.cps_debt > F.cps_buses_meals_preschool
    ? `, more than its citywide budgets for buses, meals and preschool combined (${money(F.cps_buses_meals_preschool)})` : '';
  const STARRED = [
    { id: 'city.public-safety.chicago-police-department', title: `Police: ${words(F.police)}`, body: `The biggest single department: one in every ${oneIn(F.police_share_city)} City dollars.` },
    { match: /Policemen/, title: 'Police pensions', body: `This year’s payment into a fund that holds ${cents(policeFund.funded)} for every $1 of pensions it has promised.` },
    { id: 'city.infrastructure-services.chicago-department-of-aviation', title: 'O’Hare and Midway', body: `${pct(F.aviation_airport_share, 0)} is paid from the airports’ own funds and ${pct(F.aviation_grant_share, 0)} from federal and state grants.` },
    { id: 'cps.debt', title: 'School loan payments', body: `That is ${perHead(F.cps_debt, core.meta.students)} for every CPS student${cpsCompare}.` },
  ];
  for (const s of STARRED) {
    s.node = nodes.find((n) => (s.id ? n.id === s.id : s.match.test(n.name)));
    if (s.node && !s.title.includes('$')) s.title += `: ${words(s.node.amount)}`;
  }

  const NOTE = {
    all: `${nodes.length} programs. Hover or tap a circle for its budget, then open it below.`,
    gov: 'Three separate governments, three separate budgets, side by side.',
    purpose: 'The same circles, sorted by what the money is for.',
    past: `${pct(F.past_share, 0)} of the three budgets goes to pensions and to paying back loans.`,
  };
  const LENS = {
    all: { key: () => 'all', groups: () => [{ id: 'all' }], color: (d) => COL[d.gov] },
    gov: { key: (d) => d.gov, groups: () => core.govs.map((g) => ({ id: g.id, label: g.name, total: g.amount })), color: (d) => COL[d.gov] },
    purpose: { key: (d) => d.purpose, groups: () => core.purposes.map((p) => ({ id: p.id, label: p.name, total: p.amount })), color: (d) => COL[d.gov] },
    past: {
      key: (d) => (isPast(d) ? 'past' : 'rest'),
      groups: () => [{ id: 'rest', label: 'Everything else', total: F.total - F.past }, { id: 'past', label: 'Pensions & debt', total: F.past }],
      color: (d) => (isPast(d) ? COL.past : COL.other),
    },
  };

  let W = 0, H = 0, H0 = 0, kBase = 1, lens = 'all', sim = null, settled = false, layout = null;

  function sizeField() {
    W = field.clientWidth;
    H0 = W < 700 ? Math.round(Math.max(440, W * 1.12)) : Math.round(Math.max(500, Math.min(660, innerHeight - 290, W * 0.56)));
    kBase = Math.sqrt((0.25 * W * H0) / (Math.PI * sum(nodes, (d) => d.amount)));
  }
  const baseR = (d) => Math.max(2.2, Math.sqrt(d.amount) * kBase);

  function computeLayout(name) {
    const L = LENS[name], groups = L.groups();
    for (const g of groups) {
      g.members = nodes.filter((d) => L.key(d) === g.id);
      g.R = Math.sqrt(sum(g.members, (d) => baseR(d) ** 2) / 0.64) + 3;
    }
    if (name === 'all') {
      const g = groups[0], s = Math.min(1, (H0 - 16) / (2 * g.R), (W - 16) / (2 * g.R));
      g.cx = W / 2; g.cy = H0 / 2; g.Rs = g.R * s;
      for (const d of nodes) { d.tx = g.cx; d.ty = g.cy; d.rT = baseR(d) * s; }
      return { name, groups, height: H0, s };
    }
    const cols = name === 'gov' ? (W >= 760 ? 3 : 1) : name === 'purpose' ? (W >= 1000 ? 3 : W >= 620 ? 2 : 1) : W >= 620 ? 2 : 1;
    const rows = [];
    for (let i = 0; i < groups.length; i += cols) rows.push(groups.slice(i, i + cols));
    const labelH = 52, gapY = 26, pad = 12, minSlot = 200;
    const slots = rows.map((r) => {
      if (name !== 'gov' || r.length === 1) return r.map(() => (W - 24) / cols);
      const want = r.map((g) => Math.max(minSlot, 2 * g.R + 40)), tot = sum(want);
      return want.map((w) => (w * (W - 24)) / tot);
    });
    let s = 1;
    rows.forEach((r, ri) => r.forEach((g, gi) => { s = Math.min(s, (slots[ri][gi] - 20) / (2 * g.R)); }));
    const rowMax = rows.map((r) => max(r, (g) => g.R));
    const needH = (k) => sum(rowMax, (m) => 2 * m * k + labelH) + gapY * (rows.length - 1) + pad * 2;
    const maxH = W < 760 ? Math.max(H0, 1600) : name === 'purpose' ? 900 : H0 + 20;
    if (needH(s) > maxH) s = Math.min(s, (maxH - labelH * rows.length - gapY * (rows.length - 1) - pad * 2) / sum(rowMax, (m) => 2 * m));
    const height = Math.max(name === 'purpose' ? 0 : H0, needH(s));
    let y = pad + Math.max(0, (height - needH(s)) / 2);
    rows.forEach((r, ri) => {
      const m = rowMax[ri] * s;
      const rowW = sum(slots[ri].slice(0, r.length));
      let x = (W - rowW) / 2;
      r.forEach((g, gi) => { const w = slots[ri][gi]; g.cx = x + w / 2; g.cy = y + labelH + m; g.Rs = g.R * s; x += w; });
      y += 2 * m + labelH + gapY;
    });
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    for (const d of nodes) { const g = byId[L.key(d)]; d.tx = g.cx; d.ty = g.cy; d.rT = baseR(d) * s; }
    return { name, groups, height, s };
  }

  function drawStripes() {
    // The Chicago flag: white, light blue, white, light blue, white. The circles float between the stripes.
    gStripe.selectAll('rect').data([[H * 0.17, H * 0.1], [H * 0.73, H * 0.1]]).join('rect')
      .attr('x', -2000).attr('width', W + 4000).attr('fill', '#EEF6FB')
      .attr('y', (d) => d[0]).attr('height', (d) => d[1]);
  }

  const bub = gB.selectAll('g.bub').data(nodes, (d) => d.i).join((enter) => {
    const g = enter.append('g').attr('class', 'bub');
    g.append('circle').attr('class', 'hit').attr('fill', 'transparent');
    g.append('circle').attr('class', 'mark');
    g.append('text').attr('class', 'bl').attr('text-anchor', 'middle');
    return g;
  });
  bub
    .on('pointerenter', (ev, d) => {
      select(ev.currentTarget).classed('hot', true).raise();
      const g = GOV[d.gov], sh = d.amount / g.amount;
      showTip(ev, [
        ['v', words(d.amount)],
        ['n', d.name],
        ['m', `${g.name} · ${pct(sh)} of its budget`, COL[d.gov]],
        ['m', `${PURP[d.purpose].name} · ${perHead(d.amount, POP)} per Chicagoan`],
      ]);
    })
    .on('pointermove', moveTip)
    .on('pointerleave', (ev) => { select(ev.currentTarget).classed('hot', false); hideTip(); })
    .on('click', (ev, d) => { hideTip(); onOpen(d.id); });

  const labelFont = (d) => (d.r > 62 ? 13 : d.r > 42 ? 11.5 : 10.5);
  function labelLines(d) {
    if (d.r < 27) return [];
    const fs = labelFont(d), maxc = Math.max(6, Math.floor((2 * d.r * 0.86) / (fs * 0.56)));
    const maxLines = d.r >= 35 ? 3 : 2;
    const wordsList = (d.label || d.name).split(/\s+/), lines = [];
    let cur = '';
    for (const w of wordsList) {
      if ((cur + ' ' + w).trim().length > maxc && cur) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines || lines.some((l) => l.length > maxc + 1)) return [];
    return lines;
  }
  function paintLabels() {
    bub.select('text.bl').each(function (d) {
      const t = select(this), lines = labelLines(d), fill = LENS[lens].color(d), fs = labelFont(d);
      t.attr('fill', textOn(fill)).attr('font-size', fs).attr('font-weight', 600);
      const lh = fs * 1.18, tot = lines.length + 1, y0 = -((tot - 1) * lh) / 2 + fs * 0.36;
      t.selectAll('tspan')
        .data([...lines.map((l) => ({ l, b: false })), ...(lines.length ? [{ l: money(d.amount), b: true }] : [])])
        .join('tspan')
        .attr('x', 0).attr('y', (_, i) => y0 + i * lh)
        .attr('font-weight', (p) => (p.b ? 700 : 600)).attr('opacity', (p) => (p.b ? 0.85 : 1))
        .text((p) => p.l);
    });
  }
  function render() {
    bub.attr('transform', (d) => `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`);
    bub.select('circle.mark').attr('r', (d) => d.r);
    bub.select('circle.hit').attr('r', (d) => Math.max(d.r + 3, 11));
  }
  function ticked() {
    for (const d of nodes) d.r += (d.rT - d.r) * 0.16;
    render();
    if (Math.abs(nodes[0].r - nodes[0].rT) > 0.5 || sim.alpha() > 0.3) paintLabels();
    if (lens === 'all' && settled) placeCallouts(false);
  }

  /* ---------- the four stars of the flag, pinned to four programs ---------- */
  const mobileNotes = document.getElementById('notesMobile');
  const callouts = STARRED.filter((s) => s.node).map((s) => {
    const make = () => el('div', { class: 'callout' },
      el('strong', null, star(), s.title),
      el('div', null, s.body),
      el('a', { href: '#explore', onclick: (e) => { e.preventDefault(); onOpen(s.node.id); } }, 'Open this box →'));
    const c = make();
    field.appendChild(c);
    const m = make();
    m.classList.add('on');
    mobileNotes.appendChild(m);
    return { s, el: c };
  });
  function hideCallouts() {
    callouts.forEach((c) => c.el.classList.remove('on'));
    gAnno.selectAll('*').remove();
  }
  function placeCallouts(fadeIn) {
    if (W < 980) {
      gAnno.selectAll('use.st').data(callouts).join('use').attr('class', 'st').attr('href', '#star').attr('width', 16).attr('height', 16)
        .attr('x', (c) => c.s.node.x + c.s.node.r * 0.62 - 8).attr('y', (c) => c.s.node.y - c.s.node.r * 0.62 - 8).style('color', '#D3212F');
      return;
    }
    const g = layout.groups[0], cx = g.cx, R = g.Rs, w = 210;
    const items = callouts.map((c) => ({ ...c, y: c.s.node.y }));
    [...items].sort((a, b) => a.s.node.x - b.s.node.x).forEach((it, i) => { it.side = i < 2 ? 'left' : 'right'; });
    for (const side of ['left', 'right']) {
      const list = items.filter((it) => it.side === side).sort((a, b) => a.y - b.y);
      let last = -Infinity;
      for (const it of list) { it.ly = Math.max(it.y - 30, last + 12); last = it.ly + it.el.offsetHeight; }
      let floor = H - 6;
      for (const it of [...list].reverse()) { it.ly = Math.min(it.ly, floor - it.el.offsetHeight); floor = it.ly - 12; }
      for (const it of list) it.ly = Math.max(4, it.ly);
    }
    for (const it of items) {
      const lx = it.side === 'left' ? Math.max(8, cx - R - w - 34) : Math.min(W - w - 8, cx + R + 34);
      it.el.classList.toggle('left', it.side === 'left');
      it.el.classList.toggle('right', it.side === 'right');
      it.el.style.left = lx + 'px';
      it.el.style.top = it.ly + 'px';
      if (fadeIn) setTimeout(() => it.el.classList.add('on'), reduce ? 0 : 120);
      it.ax = it.side === 'left' ? lx + w + 8 : lx - 8;
      it.ay = it.ly + 11;
    }
    const edge = (it) => { const d = it.s.node, a = Math.atan2(it.ay - d.y, it.ax - d.x); return [d.x + Math.cos(a) * (d.r + 3), d.y + Math.sin(a) * (d.r + 3)]; };
    gAnno.selectAll('path.lead').data(items).join('path').attr('class', 'lead').attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 1).attr('opacity', 0.55)
      .attr('d', (it) => { const [ex, ey] = edge(it); return `M${ex},${ey} L${it.ax},${it.ay}`; });
    gAnno.selectAll('use.st').data(items).join('use').attr('class', 'st').attr('href', '#star').attr('width', 16).attr('height', 16)
      .attr('x', (it) => edge(it)[0] - 8).attr('y', (it) => edge(it)[1] - 8).style('color', '#D3212F');
  }

  function drawClusterLabels() {
    field.querySelectorAll('.clabel').forEach((e) => e.remove());
    if (lens === 'all') return;
    for (const g of layout.groups) {
      const share = g.total / F.total;
      const c = el('div', { class: 'clabel', style: { left: g.cx + 'px', top: g.cy - g.Rs - 6 + 'px' } },
        el('b', null, g.label), el('span', null, money(g.total)), el('em', null, pct(share)));
      field.appendChild(c);
      requestAnimationFrame(() => setTimeout(() => c.classList.add('on'), reduce ? 0 : 350));
    }
  }

  const tableWrap = document.getElementById('tableWrap');
  function drawLegend() {
    const lg = document.getElementById('legend');
    const keys = lens === 'past'
      ? [['Pensions & debt', COL.past, F.past], ['Everything else', COL.other, F.total - F.past]]
      : core.govs.map((g) => [g.name, COL[g.id], g.amount]);
    lg.replaceChildren(
      ...keys.map(([name, color, amt]) => el('span', { class: 'key' }, el('i', { style: { background: color } }), el('span', null, name), el('b', null, money(amt)))),
      el('button', {
        class: 'linkbtn', type: 'button', 'aria-expanded': String(tableWrap.classList.contains('on')),
        onclick: (e) => { const on = tableWrap.classList.toggle('on'); e.currentTarget.textContent = on ? 'Hide the table' : 'View as a table'; e.currentTarget.setAttribute('aria-expanded', String(on)); },
      }, tableWrap.classList.contains('on') ? 'Hide the table' : 'View as a table'),
    );
  }
  function fillTable() {
    const tb = document.getElementById('tableBody');
    tb.replaceChildren(...[...nodes].sort((a, b) => b.amount - a.amount).map((d) =>
      el('tr', null, el('td', null, el('a', { href: `/${d.gov}/box/${encodeURIComponent(d.id)}/`, onclick: (e) => { e.preventDefault(); onOpen(d.id); } }, d.name)), el('td', null, GOV[d.gov].short), el('td', null, PURP[d.purpose].name), el('td', { class: 'n' }, exact(d.amount)))));
  }

  function applyLens(name, first) {
    lens = name;
    settled = false;
    hideCallouts();
    document.querySelectorAll('#lens button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lens === name)));
    document.getElementById('lensNote').textContent = NOTE[name];
    layout = computeLayout(name);
    H = layout.height;
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
    field.style.height = H + 'px';
    drawStripes();
    if (first || reduce) bub.select('circle.mark').attr('fill', (d) => LENS[name].color(d));
    else bub.select('circle.mark').transition().duration(500).attr('fill', (d) => LENS[name].color(d));
    paintLabels();
    drawClusterLabels();
    drawLegend();
    if (!sim) {
      sim = forceSimulation(nodes).alphaDecay(0.028).velocityDecay(0.34)
        .force('x', forceX((d) => d.tx).strength(0.08))
        .force('y', forceY((d) => d.ty).strength(0.08))
        .force('c', forceCollide((d) => d.rT + 1.6).strength(0.9).iterations(2))
        .on('tick', ticked)
        .on('end', () => { settled = true; if (lens === 'all') placeCallouts(true); });
      sim.stop();
    } else {
      sim.force('x').x((d) => d.tx);
      sim.force('y').y((d) => d.ty);
      sim.force('c').radius((d) => d.rT + 1.6);
    }
    if (first) {
      // Solve the layout first, then let every circle rise out of the lake into its place.
      for (const d of nodes) { d.x = d.tx + (Math.random() - 0.5) * 60; d.y = d.ty + (Math.random() - 0.5) * 60; d.r = d.rT; }
      sim.alpha(1);
      for (let i = 0; i < 300; i++) sim.tick();
      if (reduce) { render(); paintLabels(); settled = true; if (lens === 'all') placeCallouts(true); return; }
      const final = nodes.map((d) => [d.x, d.y]);
      const delay = new Map(shuffle(nodes.map((_, i) => i)).map((n, k) => [n, k * 7]));
      for (const d of nodes) d.y0 = H + 30 + d.rT + Math.random() * 80;
      const t = timer((elapsed) => {
        let done = true;
        for (const d of nodes) {
          const p = Math.max(0, Math.min(1, (elapsed - delay.get(d.i)) / 1100));
          if (p < 1) done = false;
          const e = easeCubicOut(p);
          d.x = final[d.i][0];
          d.y = d.y0 + (final[d.i][1] - d.y0) * e;
          d.r = d.rT * (0.35 + 0.65 * e);
        }
        render();
        if (done) { t.stop(); paintLabels(); settled = true; if (lens === 'all') placeCallouts(true); }
      });
      paintLabels();
      return;
    }
    if (reduce) {
      for (const d of nodes) d.r = d.rT;
      sim.alpha(1);
      for (let i = 0; i < 320; i++) sim.tick();
      render(); paintLabels(); settled = true;
      if (lens === 'all') placeCallouts(true);
    } else {
      sim.alpha(0.9).restart();
      setTimeout(() => { if (lens === name && !settled) { settled = true; if (name === 'all') placeCallouts(true); } }, 2600);
    }
  }

  document.querySelectorAll('#lens button').forEach((b) =>
    b.addEventListener('click', () => { applyLens(b.dataset.lens); writeHash({ lens: b.dataset.lens === 'all' ? null : b.dataset.lens }); }));
  sizeField();
  fillTable();
  applyLens(LENS[startLens] ? startLens : 'all', true);
  let rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (Math.abs(field.clientWidth - W) > 40) { sizeField(); applyLens(lens); } }, 200);
  });
}
