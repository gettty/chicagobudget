import { exact, money, words, dollars, oneIn } from './src/lib/format.js';

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (id) => `/${id.split('.')[0]}/box/${encodeURIComponent(id)}/`;
const source = (href, label) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

/** Only facts already published in core.json are rendered. Hydration replaces the card/table nodes. */
export function homepageContent(core, sources = []) {
  const F = core.facts;
  const citySource = sources.find((s) => s.dataset === '6694-f78c')?.url || '/sources/';
  const cpsSource = sources.find((s) => s.doc === 'CPS FY2026 Budget Book')?.url || '/sources/';
  // The card compares four valuations, so never cite a single fund's valuation for all four.
  const gov = core.govs.map((g) => `<li><a href="/${g.id}/">${escapeHtml(g.name)}</a>: <strong>${escapeHtml(exact(g.amount))}</strong> (${escapeHtml(g.period)})</li>`).join('');
  const GOV = Object.fromEntries(core.govs.map((g) => [g.id, g.short]));
  const PURPOSE = Object.fromEntries(core.purposes.map((p) => [p.id, p.name]));
  const rows = [...core.bubbles].sort((a, b) => b.amount - a.amount).map((b) => `<tr><td><a href="${page(b.id)}">${escapeHtml(b.name)}</a></td><td>${escapeHtml(GOV[b.gov])}</td><td>${escapeHtml(PURPOSE[b.purpose])}</td><td class="n">${escapeHtml(exact(b.amount))}</td></tr>`).join('');
  const cards = [
    ['Pensions & debt', `One in ${oneIn(F.past_share)} dollars pays for the past`, `Of the ${money(F.total)} the three governments budget for 2026, ${words(F.past)} goes into pension funds and to paying back loans.`, '/methods#groups', 'Read how this is grouped', '/sources/'],
    ['City pension funds', `${Math.round(Math.min(...core.pensions.map((p) => p.funded)) * 100)} to ${Math.round(Math.max(...core.pensions.map((p) => p.funded)) * 100)} cents saved for every dollar promised`, `The City’s four funds are ${words(F.unfunded_city_pensions)} short. Funded ratios are from actuarial valuations, not annual budget spending.`, page('city.retirement'), 'Open the pension funds', '/sources/'],
    ['Police', `${words(F.police)}, one in ${oneIn(F.police_share_city)} City dollars`, `${money(F.police_overtime)} is budgeted for overtime, not overtime already paid.`, page('city.public-safety.chicago-police-department'), 'Open the Police Department', citySource],
    ['Schools', `${dollars(F.cps_per_student)} per CPS student`, `With every cost in, from buses to pensions. Inside a school’s own budget the median is ${dollars(F.school_median_per_student)} per student.`, page('cps.schools'), 'See the schools', cpsSource],
    ['Checks written', 'The City’s biggest payees this year', `Payments made ${core.meta.periods.city_2026_to_0928.label}. Payments to individuals are pooled and not shown. These are actual checks, not the budget.`, '/city/', 'Explore City spending', 'https://data.cityofchicago.org/resource/s4vu-giwb'],
    ['Counted twice', `${words(F.counted_twice)} moves between City funds`, `The ordinance’s gross ${words(F.gross_city)} counts internal transfers twice. This site uses the net ${words(F.gross_city - F.counted_twice + F.obm_adjustment)}; the adjustment is explained in the methods.`, '/methods#twice', 'How net is calculated', citySource],
  ];
  return {
    governments: `<section class="budget-browse" aria-labelledby="budget-browse-title"><h2 id="budget-browse-title">Browse the three official budgets</h2><ul>${gov}</ul><p class="fine">These are separate governments. City and Parks use calendar year 2026; CPS uses July 2025 through June 2026. The combined figure above is for scale only, not an official consolidated budget. <a href="/methods#three-budgets">How to compare them</a>.</p></section>`,
    rows,
    receipt: [...core.purposes].sort((a, b) => b.amount - a.amount).map((p) => `<li class="${p.id === 'pensions' || p.id === 'debt' ? 'past' : ''}"><span class="nm">${escapeHtml(p.name)}</span><span class="dots"></span><span class="amt">${escapeHtml(dollars(p.amount / 100 / core.meta.population))}</span></li>`).join(''),
    cards: cards.map(([label, title, description, href, action, citation], i) => `<article class="card ${i === 0 || i === 5 ? 'wide' : ''}"><p class="ck">${escapeHtml(label)}</p><h3>${escapeHtml(title)}</h3><p class="cd">${escapeHtml(description)}</p><a class="cta" href="${escapeHtml(href)}">${escapeHtml(action)} →</a><p class="fine">${source(citation, 'Source and records')}</p></article>`).join(''),
  };
}

export function siteMetadata(path, origin = 'https://chicagobudget.com') {
  const url = `${origin}${path}`;
  const methods = path === '/methods';
  const title = methods ? 'How it works · Chicago’s 2026 budget' : 'Where Chicago’s 2026 budgets go · Chicago Budget';
  const description = methods ? 'How to read the separate 2026 City, CPS and Parks budgets: net and gross amounts, estimates, source records, privacy and data gaps.' : 'Explore the separate 2026 budgets of Chicago, Chicago Public Schools and the Chicago Park District, with source-backed figures and program detail.';
  return `<link rel="canonical" href="${escapeHtml(url)}">\n<meta property="og:url" content="${escapeHtml(url)}">\n<meta property="og:type" content="website">\n<meta property="og:title" content="${escapeHtml(title)}">\n<meta property="og:description" content="${escapeHtml(description)}">\n<meta property="og:image" content="${escapeHtml(origin)}/og.jpg">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${escapeHtml(title)}">\n<meta name="twitter:description" content="${escapeHtml(description)}">\n<meta name="twitter:image" content="${escapeHtml(origin)}/og.jpg">`;
}

export const websiteSchema = () => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Chicago Budget', url: 'https://chicagobudget.com/', description: 'An independent exploration of the separate City of Chicago, Chicago Public Schools and Chicago Park District budgets.' }).replace(/</g, '\\u003c')}</script>`;
