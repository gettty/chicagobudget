import { select } from 'd3-selection';
import 'd3-transition';
import { easeCubicInOut } from 'd3-ease';
import { sum, group, min, max } from 'd3-array';
import { money, words, pct, oneIn } from '../lib/format.js';
import { COL, el, showTip, moveTip, hideTip, reduceMotion, onceVisible } from '../lib/ui.js';

/**
 * 1,000 city blocks, $27.7M each, laid out like Chicago's street grid: a wider street every 10
 * blocks across and 5 down, so each district between them is 5% of the three budgets.
 */
export function initGrid(container, core) {
  const reduce = reduceMotion();
  const cells = core.cells.map(([gov, purpose, type, amount]) => ({ gov, purpose, type, amount }));
  const GOV = Object.fromEntries(core.govs.map((g) => [g.id, g]));
  const PURP = Object.fromEntries(core.purposes.map((p) => [p.id, p]));
  const TYPE = { people: 'Pay for today’s workers', things: 'Services, supplies & construction', past: 'Pensions & debt' };
  const total = sum(cells, (c) => c.amount);

  // Round each government first, then the purposes and types inside it, so every count agrees.
  const apportion = (items, seats, w) => {
    const s = sum(items, w);
    items.forEach((it) => { it.exact = (w(it) / s) * seats; it.n = Math.floor(it.exact); });
    [...items].sort((a, b) => b.exact - b.n - (a.exact - a.n)).slice(0, seats - sum(items, (it) => it.n)).forEach((it) => it.n++);
  };
  const govSeats = core.govs.map((g) => ({ id: g.id, amount: sum(cells.filter((c) => c.gov === g.id), (c) => c.amount) }));
  apportion(govSeats, 1000, (g) => g.amount);
  for (const g of govSeats) apportion(cells.filter((c) => c.gov === g.id), g.n, (c) => c.amount);
  const pOrder = core.purposes.map((p) => p.id), gOrder = ['city', 'cps', 'parks'], tOrder = ['people', 'things', 'past'];
  const blocks = [];
  for (const c of cells) for (let i = 0; i < c.n; i++) blocks.push({ ...c, id: blocks.length });
  const cmp = (...keys) => (a, b) => { for (const [k, ord] of keys) { const d = ord.indexOf(a[k]) - ord.indexOf(b[k]); if (d) return d; } return a.id - b.id; };
  const isPast = (b) => b.type === 'past';
  const countOf = (pred) => blocks.filter(pred).length;

  const STEPS = {
    all: { label: 'Everything', sort: cmp(['gov', gOrder], ['purpose', pOrder], ['type', tOrder]), color: () => '#D9DCE0',
      caption: `This is all of it: ${money(total)}, the 2026 budgets of three separate governments. Every block is the same size, ${words(total / 1000)}.` },
    gov: { label: 'By government', sort: cmp(['gov', gOrder], ['purpose', pOrder], ['type', tOrder]), color: (b) => COL[b.gov],
      groups: (b) => b.gov, name: (g) => [GOV[g].name, money(GOV[g].amount)],
      caption: `The City spends ${countOf((b) => b.gov === 'city')} blocks, Chicago Public Schools ${countOf((b) => b.gov === 'cps')} and the Park District ${countOf((b) => b.gov === 'parks')}.` },
    past: { label: 'Pensions & debt',
      sort: (a, b) => isPast(b) - isPast(a) || (a.purpose === 'pensions' ? 0 : 1) - (b.purpose === 'pensions' ? 0 : 1) || a.id - b.id,
      color: (b) => (isPast(b) ? COL.past : '#D9DCE0'),
      groups: (b) => (isPast(b) ? b.purpose : 'rest'),
      name: (g) => (g === 'rest' ? ['Everything else', money(total - core.facts.past)] : [PURP[g].name, money(PURP[g].amount)]),
      caption: `${countOf(isPast)} blocks pay for decisions made years ago: money into pension funds and payments on old loans. About one district in ${oneIn(countOf(isPast) / 1000)}.` },
    type: { label: 'Pay vs. things', sort: cmp(['type', tOrder], ['gov', gOrder], ['purpose', pOrder]), color: (b) => COL[b.type],
      groups: (b) => b.type, name: (t) => [TYPE[t], money(sum(cells.filter((c) => c.type === t), (c) => c.amount))],
      caption: `Most of the rest pays people: ${countOf((b) => b.type === 'people')} blocks of pay and health care for today’s workers, and ${countOf((b) => b.type === 'things')} for services, supplies and construction.` },
  };

  const chips = el('div', { class: 'seg small', role: 'tablist', 'aria-label': 'Group the blocks' });
  const stage = el('div', { class: 'gstage' });
  const caption = el('p', { class: 'gcap', 'aria-live': 'polite' });
  const key = el('div', { class: 'gkey' });
  container.append(chips, stage, caption, key, el('p', { class: 'fine' }, `Each block is ${words(total / 1000)}, one-tenth of a percent. Each district between the wide streets is 50 blocks, or 5%.`));
  const svg = select(stage).append('svg').attr('role', 'img').attr('aria-label', '1,000 blocks, each one-thousandth of the three budgets');
  let geo = null, current = 'all', playing = null;

  function measure() {
    const w = stage.clientWidth, g = 2, G = w < 520 ? 5 : 8;
    const s = Math.max(4, Math.floor((w - 39 * g - 3 * (G - g)) / 40));
    geo = { s, g, G, W: 40 * s + 39 * g + 3 * (G - g), H: 25 * s + 24 * g + 4 * (G - g) };
    svg.attr('width', geo.W).attr('height', geo.H);
    stage.style.height = geo.H + 'px';
  }
  function xy(k) {
    const { s, g, G } = geo, d = Math.floor(k / 50), j = k % 50, dc = d % 4, dr = Math.floor(d / 4), col = j % 10, row = Math.floor(j / 10);
    return [dc * (10 * s + 9 * g + G) + col * (s + g), dr * (5 * s + 4 * g + G) + row * (s + g)];
  }
  const rects = svg.selectAll('rect').data(blocks).join('rect').attr('rx', 1.5).attr('fill', '#D9DCE0')
    .on('pointerenter', (ev, b) => {
      const c = cells.find((c) => c.gov === b.gov && c.purpose === b.purpose && c.type === b.type);
      showTip(ev, [['v', `${c.n} blocks · ${money(c.amount)}`], ['n', `${PURP[b.purpose].name}: ${TYPE[b.type].toLowerCase()}`], ['m', GOV[b.gov].name, COL[b.gov]]]);
      select(ev.currentTarget).attr('stroke', '#0F1C2E').attr('stroke-width', 1.5);
    })
    .on('pointermove', moveTip)
    .on('pointerleave', (ev) => { hideTip(); select(ev.currentTarget).attr('stroke', null); });

  function place(name, animate) {
    const st = STEPS[name];
    current = name;
    [...blocks].sort(st.sort).forEach((b, k) => { const [x, y] = xy(k); b.x = x; b.y = y; b.k = k; });
    rects.transition('move').duration(animate && !reduce ? 800 : 0).ease(easeCubicInOut)
      .delay((b) => (animate && !reduce ? b.k * 0.45 : 0))
      .attr('x', (b) => b.x).attr('y', (b) => b.y).attr('width', geo.s).attr('height', geo.s).attr('fill', st.color);
    chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.step === name)));
    caption.textContent = st.caption;
    stage.querySelectorAll('.glabel').forEach((e) => e.remove());
    if (st.groups) {
      for (const [gk, list] of group(blocks, st.groups)) {
        const x0 = min(list, (b) => b.x), x1 = max(list, (b) => b.x + geo.s), y0 = min(list, (b) => b.y), y1 = max(list, (b) => b.y + geo.s);
        const [nm, amt] = st.name(gk);
        const small = list.length < 60;
        const lab = el('div', { class: 'glabel', style: { left: (small ? Math.min(geo.W - 80, (x0 + x1) / 2) : (x0 + x1) / 2) + 'px', top: (small ? y1 + 16 : (y0 + y1) / 2) + 'px' } },
          el('b', null, nm + ' '), el('span', null, `${amt} · ${list.length} blocks`));
        stage.append(lab);
        setTimeout(() => lab.classList.add('on'), animate && !reduce ? 900 : 0);
      }
    }
    const keys = name === 'all' ? [] : name === 'gov' ? gOrder.map((g) => [COL[g], GOV[g].name]) : name === 'past' ? [[COL.past, 'Pensions & debt'], ['#D9DCE0', 'Everything else']] : tOrder.map((t) => [COL[t], TYPE[t]]);
    key.replaceChildren(...keys.map(([c, n]) => el('span', null, el('i', { style: { background: c } }), n)));
  }

  for (const [k, st] of Object.entries(STEPS)) {
    chips.append(el('button', { type: 'button', role: 'tab', 'data-step': k, 'aria-selected': String(k === 'all'), onclick: () => { stop(); place(k, true); } }, st.label));
  }
  function stop() { if (playing) { clearInterval(playing); playing = null; } }
  measure();
  place('all', false);
  if (!reduce) rects.attr('opacity', 0).transition('fade').duration(500).delay((b) => (39 - Math.floor(b.x / (geo.s + geo.g))) * 16 + Math.random() * 100).attr('opacity', 1);
  onceVisible(container, () => {
    if (reduce) { place('past', false); return; }
    const seq = ['gov', 'past'];
    let i = 0;
    playing = setInterval(() => { place(seq[i++], true); if (i >= seq.length) stop(); }, 2400);
  }, 0.45);
  let rz;
  new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { measure(); place(current, false); }, 150); }).observe(stage);
}
