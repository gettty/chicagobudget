// Small shared UI pieces: colors, the tooltip, element helpers, motion preference, URL state.

export const COL = { city: '#2A78D6', cps: '#EB6834', parks: '#1BAF7A', past: '#E34948', other: '#CDD5DD', people: '#4A3AA7', things: '#EDA100', twice: '#8C97A3' };
export const TINT = {
  city: ['#DCE9F9', '#C3DAF5'], cps: ['#FCE3D7', '#F8CDB7'], parks: ['#D5F1E6', '#B3E6D2'],
  'city-twice': ['#E6E9ED', '#D3D9DF'], all: ['#E3EEF6', '#CFE2F0'],
};
export const INK = '#0F1C2E';

export const reduceMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still\b/.test(location.search);

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** White or ink, whichever reads better on a fill. */
export function textOn(hex) {
  const L = lum(hex);
  return 1.05 / (L + 0.05) >= (L + 0.05) / (lum(INK) + 0.05) ? '#fff' : INK;
}

/** el('div', {class: 'x'}, 'text', child...). Text is always set with textContent. */
export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

/* ---------- the tooltip: one for the whole page ---------- */
let tip;
export function tooltip() {
  if (!tip) {
    tip = el('div', { class: 'tip', role: 'tooltip' });
    document.body.appendChild(tip);
  }
  return tip;
}
/** rows: [className, text, keyColor?]. The value row comes first. */
export function showTip(ev, rows) {
  const t = tooltip();
  t.replaceChildren(...rows.filter(Boolean).map(([cls, text, color]) => el('div', { class: cls }, color ? el('i', { style: { background: color } }) : null, text)));
  t.classList.add('on');
  moveTip(ev);
}
export function moveTip(ev) {
  const t = tooltip();
  const r = t.getBoundingClientRect();
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (ev.clientX === undefined) {
    const b = ev.target.getBoundingClientRect();
    x = b.left + b.width / 2; y = b.bottom + 8;
  }
  if (x + r.width > innerWidth - 8) x = Math.max(8, (ev.clientX ?? x) - r.width - 16);
  if (y + r.height > innerHeight - 8) y = Math.max(8, (ev.clientY ?? y) - r.height - 16);
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}
export const hideTip = () => tip && tip.classList.remove('on');

/* ---------- URL state: #box=<id>&by=purpose&view=swarm&lens=past ---------- */
export function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return Object.fromEntries(p.entries());
}
export function writeHash(patch) {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}

/** Run fn once when el scrolls into view. */
export function onceVisible(node, fn, threshold = 0.25) {
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { threshold });
  io.observe(node);
}

export const star = (cls = 'star') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#star');
  s.appendChild(u);
  return s;
};
