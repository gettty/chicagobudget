import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/800';
import '@fontsource-variable/source-serif-4/opsz';
import './styles/main.css';
import * as D from './lib/data.js';
import { money, words, dollars, count } from './lib/format.js';
import { readHash, reduceMotion } from './lib/ui.js';
import { initHero } from './hero/bubbles.js';
import { initAtlas } from './atlas/atlas.js';
import { initStories } from './stories/stories.js';
import { initShare } from './share/share.js';

if (/[?&]still\b/.test(location.search)) document.documentElement.classList.add('still');

async function start() {
  let core;
  try {
    core = await D.loadCore();
  } catch (e) {
    document.getElementById('field').replaceChildren(Object.assign(document.createElement('p'), { className: 'loadfail', textContent: 'The budget data did not load. Refresh the page to try again.' }));
    throw e;
  }
  const F = core.facts;
  const state = readHash();
  document.querySelectorAll('[data-fact]').forEach((n) => {
    const v = { total: money(F.total), totalWords: words(F.total), perSecond: dollars(F.per_second), perResident: dollars(F.per_resident), boxes: count(core.meta.nodes) }[n.dataset.fact];
    if (v) n.textContent = v;
  });

  const atlas = initAtlas(core);
  const openBox = (id, opts) => atlas.open(id, opts);
  initHero(core, { onOpen: (id) => openBox(id), lens: state.lens });
  initStories(core, atlas);
  initShare(core);
  atlas.init(state);

  // Everything below the fold can wait: load the full tree once the first screen is drawn.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => D.loadTree().catch(() => {}), { timeout: 3000 });

  document.querySelectorAll('[data-search]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); atlas.focusSearch(); }));
  addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      atlas.focusSearch();
    }
  });
  addEventListener('hashchange', () => {
    const s = readHash();
    if (s.box) atlas.open(s.box, { by: s.by || 'gov', view: s.view || 'boxes', scroll: true });
  });
  if (state.box && !reduceMotion()) setTimeout(() => document.getElementById('explore').scrollIntoView({ block: 'start' }), 60);
  else if (state.box) document.getElementById('explore').scrollIntoView({ block: 'start' });
}

start();
