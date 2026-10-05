import { money, pct, dollars } from '../lib/format.js';
import { COL, el, showTip, moveTip, hideTip, reduceMotion, onceVisible } from '../lib/ui.js';

/** Your share: the three budgets per resident or household, a live meter, and the tax bill split. */
export function initShare(core) {
  const reduce = reduceMotion();
  const F = core.facts;
  const PER = { resident: core.meta.population, household: core.meta.households };
  let per = 'resident';
  const list = document.getElementById('ritems');
  const ordered = [...core.purposes].sort((a, b) => b.amount - a.amount);
  const rows = ordered.map((p) => {
    const amt = el('span', { class: 'amt' }, '$0');
    amt.dataset.v = p.amount;
    list.append(el('li', { class: p.id === 'pensions' || p.id === 'debt' ? 'past' : '' }, el('span', { class: 'nm' }, p.name), el('span', { class: 'dots' }), amt));
    return amt;
  });
  const total = document.getElementById('rtotal');
  const note = document.getElementById('rnote');

  function countTo(node, v, dur) {
    const from = parseFloat(node.dataset.shown || 0), t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      node.textContent = dollars(from + (v - from) * e);
      if (t < 1) requestAnimationFrame(step); else node.dataset.shown = v;
    };
    if (reduce) { node.textContent = dollars(v); node.dataset.shown = v; } else requestAnimationFrame(step);
  }
  function render() {
    rows.forEach((a) => countTo(a, a.dataset.v / 100 / PER[per], 900));
    countTo(total, F.total / 100 / PER[per], 1100);
    note.textContent = per === 'resident'
      ? `${core.meta.population.toLocaleString('en-US')} residents (Census ACS 2024). Red rows pay for the past.`
      : `${core.meta.households.toLocaleString('en-US')} households (Census ACS 2024). Red rows pay for the past.`;
    document.querySelectorAll('#per button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.per === per)));
  }
  document.querySelectorAll('#per button').forEach((b) => b.addEventListener('click', () => { per = b.dataset.per; render(); }));

  /* the meter: $879 a second, counted from the moment the page opened */
  const live = document.getElementById('liveCount');
  const t0 = performance.now();
  const tick = () => {
    live.textContent = '$' + Math.floor(((performance.now() - t0) / 1000) * F.per_second).toLocaleString('en-US');
    if (!reduce) requestAnimationFrame(tick);
  };
  if (reduce) setInterval(tick, 1000);
  tick();

  /* the property tax bill */
  const TAX = [
    ['Chicago Public Schools', ['Chicago Public Schools (Board of Education)'], COL.cps],
    ['City of Chicago', ['City of Chicago (corporate levy plus library fund)', 'City of Chicago School Building and Improvement Fund (separate City levy, listed apart)'], COL.city],
    ['Cook County', ['Cook County (county + forest preserve)'], '#8C97A3'],
    ['Water Reclamation District', ['Water Reclamation District (stormwater and sewage treatment)'], '#A9B3BD'],
    ['Chicago Park District', ['Chicago Park District'], COL.parks],
    ['City Colleges', ['City Colleges'], '#C7CED6'],
  ].map(([name, keys, color]) => ({ name, color, share: keys.reduce((s, k) => s + (core.taxbill[k] || 0), 0) }));
  const tbar = document.getElementById('tbar'), tlist = document.getElementById('tlist');
  for (const t of TAX) {
    t.el = el('div', {
      style: { background: t.color, flexGrow: 0.0001, flexBasis: 0 },
      onpointerenter: (ev) => showTip(ev, [['v', pct(t.share, 1)], ['n', t.name], ['m', 'Share of the 2025 composite tax rate', t.color]]),
      onpointermove: moveTip, onpointerleave: hideTip,
    });
    tbar.append(t.el);
    tlist.append(el('li', null, el('i', { style: { background: t.color } }), el('b', null, pct(t.share, 1)), el('span', null, t.name)));
  }
  onceVisible(document.getElementById('share'), () => { render(); TAX.forEach((t) => { t.el.style.flexGrow = t.share; }); });
}
