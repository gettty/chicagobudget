// Optional first-party aggregate event client. No endpoint or consent is configured by default.
// The receiving service must count allowlisted actions only, discard request metadata
// (including IP, user agent and Referer), and avoid retaining individual event logs.
const ACTIONS = new Set(['budget_open', 'official_source_follow', 'dataset_download', 'permalink_share']);
const OFFICIAL_HOSTS = new Set(['chicago.gov', 'www.chicago.gov', 'cps.edu', 'www.cps.edu', 'chicagoparkdistrict.com', 'www.chicagoparkdistrict.com', 'data.cityofchicago.org']);
const DATA_FILE = /\.(?:csv|json|zip|parquet|gz|xls|xlsx)$/i;
const INSTALL_KEY = Symbol.for('chicagobudget.actionAnalytics');

export function classifyLink(href, base) {
  let url;
  try { url = new URL(href, base); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const local = url.origin === new URL(base).origin;
  if (local && /^\/(?:city|cps|parks)(?:\/|$)/.test(url.pathname)) return 'budget_open';
  const snapshot = (url.hostname === 'github.com' && /^\/gettty\/chicagobudget\/(?:tree|blob)\/(?:main|[a-f0-9]{40})\/data\/public\/2026\//.test(url.pathname)) ||
    (url.hostname === 'raw.githubusercontent.com' && /^\/gettty\/chicagobudget\/(?:main|[a-f0-9]{40})\/data\/public\/2026\//.test(url.pathname));
  if (DATA_FILE.test(url.pathname) && (snapshot || (local && /^\/(?:datasets|resources|data)\//.test(url.pathname)))) return 'dataset_download';
  if (OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) return 'official_source_follow';
  return null;
}

export function createActionTracker({ endpoint, consent, send, now = Date.now }) {
  // Same-origin, path-only endpoint. Never allow a query, fragment, credentials or remote collector.
  if (!/^\/[a-z0-9/_-]+$/i.test(endpoint || '') || endpoint.startsWith('//')) return () => false;
  const seen = new Map();
  return (action, gov = 'none') => {
    if (!consent() || !ACTIONS.has(action)) return false;
    if (!['city', 'cps', 'parks', 'none'].includes(gov)) return false;
    const time = now();
    const key = `${action}:${gov}`;
    if (time - (seen.get(key) ?? -Infinity) < 1500) return false;
    seen.set(key, time);
    send(endpoint, JSON.stringify({ action, gov }));
    return true;
  };
}

export function installActionTracking(win, endpoint) {
  if (win[INSTALL_KEY]) return win[INSTALL_KEY];
  const validEndpoint = /^\/[a-z0-9/_-]+$/i.test(endpoint || '') && !endpoint.startsWith('//');
  const privacySignal = () => win.navigator?.globalPrivacyControl === true || win.navigator?.doNotTrack === '1';
  const track = createActionTracker({
    endpoint,
    consent: () => { try { return !privacySignal() && win.localStorage.getItem('cb-analytics-consent') === 'yes'; } catch { return false; } },
    send: (path, body) => win.fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
    }).catch(() => {}),
  });
  win.document.addEventListener('click', (event) => {
    const element = event.target?.closest?.('a[href],button[data-permalink-share]');
    if (!element) return;
    if (element.matches('button[data-permalink-share]')) {
      // A path-only permalink, without searches, fragments or query parameters.
      const permalink = new URL(win.location.pathname, win.location.origin).href;
      const copy = win.navigator.clipboard?.writeText(permalink);
      if (!copy) { element.textContent = 'Copy unavailable'; return; }
      copy.then(() => { element.textContent = 'Link copied'; track('permalink_share'); })
        .catch(() => { element.textContent = 'Copy unavailable'; });
      return;
    }
    const action = classifyLink(element.getAttribute('href'), win.location.href);
    if (action) {
      const path = new URL(element.getAttribute('href'), win.location.href).pathname;
      const gov = /^\/(city|cps|parks)(?:\/|$)/.exec(path)?.[1] || 'none';
      track(action, gov);
    }
  });
  if (validEndpoint) {
    const mount = () => {
      const parent = win.document.querySelector('footer') || win.document.body;
      if (!parent || win.document.querySelector('[data-action-consent]')) return;
      const section = win.document.createElement('section');
      section.setAttribute('data-action-consent', '');
      section.setAttribute('aria-label', 'Optional action counts');
      const explanation = win.document.createElement('p');
      explanation.textContent = 'Optional aggregate action counts help us see which budget areas, official sources, downloads and links are useful. The event payload contains only an action type and budget group, never search terms, names, URLs or client identifiers. The network still processes your request. You can change this choice any time.';
      const status = win.document.createElement('p');
      status.setAttribute('aria-live', 'polite');
      const yes = win.document.createElement('button');
      yes.type = 'button'; yes.textContent = 'Allow action counts';
      const no = win.document.createElement('button');
      no.type = 'button'; no.textContent = 'Do not count my actions';
      const refresh = () => {
        let allowed = false;
        try { allowed = !privacySignal() && win.localStorage.getItem('cb-analytics-consent') === 'yes'; } catch {}
        status.textContent = privacySignal() ? 'Action counts off: browser privacy preference.' : allowed ? 'Action counts on.' : 'Action counts off.';
        yes.disabled = privacySignal() || allowed;
        no.disabled = !allowed;
      };
      yes.addEventListener('click', () => { try { win.localStorage.setItem('cb-analytics-consent', 'yes'); } catch {} refresh(); });
      no.addEventListener('click', () => { try { win.localStorage.removeItem('cb-analytics-consent'); } catch {} refresh(); });
      section.append(explanation, status, yes, no);
      parent.append(section);
      refresh();
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
  win[INSTALL_KEY] = track;
  return track;
}

// Called by interactive atlas transitions that do not use anchors. Never send
// a box ID; the tracker retains only the government enum and dedupe window.
export function recordBudgetOpen(id, win = window) {
  if (typeof id !== 'string') return false;
  const gov = id.startsWith('city-twice') ? 'city' : /^(city|cps|parks)(?:\.|$)/.exec(id)?.[1];
  return gov ? (win[INSTALL_KEY]?.('budget_open', gov) ?? false) : false;
}
