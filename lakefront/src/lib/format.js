// Every amount in the data is integer cents. These helpers turn cents into words people read.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Short form for charts and tiles: $16.8B, $2.11B, $638M, $12.4M, $86K. */
export function money(cents) {
  const a = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** Spoken form for headlines and tooltips: $2.11 billion. */
export function words(cents) {
  const a = Math.abs(cents) / 100;
  const sign = cents < 0 ? 'minus ' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)} billion`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)} million`;
  return sign + '$' + Math.round(a).toLocaleString('en-US');
}

/** Exact, to the cent. */
export const exact = (cents) => usd.format(cents / 100);

/** Whole dollars from a dollar value (not cents). */
export const dollars = (d) => '$' + Math.round(d).toLocaleString('en-US');

/** A share as a percent; one decimal below 10%, "<0.1%" for slivers. */
export function pct(share, digits) {
  if (!isFinite(share)) return '–';
  const p = share * 100;
  const d = digits ?? (Math.abs(p) < 10 ? 1 : 0);
  if (p > 0 && p < 0.1) return '<0.1%';
  return p.toFixed(d) + '%';
}

/** Cost per resident in readable form: $1,200 or 34¢. */
export function perHead(cents, people) {
  const d = cents / 100 / people;
  if (Math.abs(d) >= 100) return dollars(d);
  if (Math.abs(d) >= 1) return '$' + d.toFixed(2);
  return Math.max(0, Math.round(d * 100)) + '¢';
}

export const count = (n) => Math.round(n).toLocaleString('en-US');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** 8 → "eight"; numbers above twelve stay as digits. */
export const numberWord = (n) => WORDS[Math.round(n)] ?? count(n);

/** "One in four" for a share near 1/4: the nearest whole "one in N". */
export const oneIn = (share) => numberWord(Math.round(1 / share));

/** First letter upper case. */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const BASIS = {
  budget: ['In the budget', 'The amount is printed in a budget. It is a plan, not money already spent.'],
  tied: ['Adds up exactly', 'The smaller amounts add up to a published total.'],
  gov_estimate: ['Government estimate', 'The government published an estimate. It is not an exact payment.'],
  proxy: ['Our estimate', 'ChicagoBudget.com estimated a split the budget does not print, using a stated method.'],
  residual: ['Leftover', 'What is left after the known parts are subtracted from the box above.'],
  adjustment: ['Adjustment', 'An addition or subtraction needed to make the totals match.'],
  paid_to_date: ['Paid so far', 'Money actually paid in the period shown, not a full-year budget.'],
};
