#!/usr/bin/env python3
"""Build Lakefront's data files from ChicagoBudget.com's public data export.

Input (read-only):
  CB_REPO    the chicagobudget repository, for committed context files in data/
             default: the parent folder when this lives inside the repo, else ../chicagobudget
  CB_EXPORT  the site data (manifest.json, chunks/, side/, sources.json, vendors.json ...)
             default: $CB_REPO/data/public/2026/site (committed), else $CB_REPO/site/public/data

Output: public/data/
  core.json        everything the first screen needs (hero bubbles, top three levels, stories)
  tree.json        all 47,360 boxes as a compact skeleton, loaded after first paint
  details/N.json   per-box details (why, notes, side facts, sources, pay-versus-things mix), on demand
  sources.json     the source records boxes point to
  methods.json     coverage, dead ends and source summaries for the methods page

Only the public export is used, which is already privacy-filtered by the upstream build:
no individual's name appears in it. Every grouping added here (purpose, what the money
buys) is a classification of existing boxes and still adds up to the official totals.
"""
import collections
import glob
import json
import os
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Works inside the chicagobudget repository (as lakefront/) or next to a clone of it.
_IN_REPO = (ROOT.parent / 'build/export_site.py').exists()
REPO = Path(os.environ.get('CB_REPO', ROOT.parent if _IN_REPO else ROOT.parent / 'chicagobudget'))
# The committed copy of the production site data (data/public/2026/site) needs no build step;
# a fresh local export (site/public/data, from build/export_site.py) is used when that is absent.
_SITE_DATA = [REPO / 'data/public/2026/site', REPO / 'site/public/data']
SRC = Path(os.environ.get('CB_EXPORT') or next((p for p in _SITE_DATA if (p / 'manifest.json').exists()), _SITE_DATA[0]))
OUT = ROOT / 'public/data'
CHUNK = 400  # boxes per details file, in depth-first order so a branch shares files
POP, HOUSEHOLDS, STUDENTS = 2_721_326, 1_172_455, 316_224

if not (SRC / 'manifest.json').exists():
    sys.exit(f'No site data at {SRC}. Set CB_EXPORT, or run from a chicagobudget checkout that has data/public/2026/site.')
print(f'reading {SRC}')

manifest = json.loads((SRC / 'manifest.json').read_text())
nodes = {}
for f in glob.glob(str(SRC / 'chunks/*.json')):
    for n in json.load(open(f))['nodes']:
        nodes[n['id']] = n
assert len(nodes) == manifest['counts']['nodes'], (len(nodes), manifest['counts']['nodes'])
kids = collections.defaultdict(list)
for n in nodes.values():
    if n['parent_id']:
        kids[n['parent_id']].append(n)
for lst in kids.values():
    lst.sort(key=lambda n: (-abs(n['amount_cents']), n['name']))
_side = {}


def side(n):
    ref = n.get('side_ref')
    if ref:
        if ref not in _side:
            _side[ref] = json.load(open(SRC / ref))
        return _side[ref]
    return n.get('side') or []


ROOTS = ['city', 'cps', 'parks', 'city-twice']

# ---------------------------------------------------------------- purpose & what it buys
PURPOSES = [
    ('schools', 'Schools', 'Classrooms, buses, special education and school buildings'),
    ('move', 'Streets, water, trash & airports', 'Transportation, O’Hare and Midway, water, sewers and sanitation'),
    ('pensions', 'Pensions', 'Payments into the retirement funds of City, school and park workers'),
    ('safety', 'Police, fire & 911', 'Police, fire, emergency communications and police oversight'),
    ('debt', 'Paying back loans', 'Principal and interest on bonds'),
    ('gov', 'Running the governments', 'Offices, technology, the council, inspections and citywide costs'),
    ('health', 'Health, families & libraries', 'Public health, family services and libraries'),
    ('benefits', 'Employee health care', 'Health insurance and claims for current workers'),
    ('parks', 'Parks, culture & housing', 'Parks, museums, the zoo, housing and planning'),
]
TOP = {
    'city.infrastructure-services': 'move', 'city.public-safety': 'safety', 'city.retirement': 'pensions',
    'city.loans': 'debt', 'city.community-services': 'health', 'city.citywide': 'gov',
    'city.finance-and-administration': 'gov', 'city.health': 'benefits', 'city.city-development': 'parks',
    'city.regulatory': 'gov', 'city.obm-unexplained': 'gov', 'city.legislative-and-elections': 'gov',
    'cps.schools': 'schools', 'cps.citywide': 'schools', 'cps.capital': 'schools', 'cps.central': 'gov',
    'cps.debt': 'debt', 'cps.pensions': None,
    'parks.parks-and-recreation': 'parks', 'parks.maintaining-the-parks': 'parks', 'parks.managed-venues': 'parks',
    'parks.museums-and-the-zoo': 'parks', 'parks.building-and-fixing-parks': 'parks',
    'parks.paying-back-loans': 'debt', 'parks.retirement-pensions': 'pensions', 'parks.running-the-district': 'gov',
    'parks.utilities-benefits-and-shared-costs': 'gov', 'parks.not-itemised': 'gov',
}
PEOPLE = re.compile(r'\b(pay|salar|wage|overtime|benefit|health|insurance|dental|pension|raise|back pay|worker|staff|medicare|payroll|fringe|stipend|trainee|extra hire|employ|personnel|compensation|sick|vacation|substitute|teacher|unemployment|retire)', re.I)
THINGS = re.compile(r'(contract|service|suppl|equipment|construction|program|grant|commodit|travel|transport|utilit|food|rent|lease|reserve|claim|charge|indirect|vehicle|repair|maintenance|software|book|material|printing|fuel|project|capital|building|land|tax|transfer|settlement|judgment|professional|technical|legal|consult|fee|third party)', re.I)


def purpose_of(nid):
    parts = nid.split('.')
    if parts[0] == 'city-twice':
        return None
    top = '.'.join(parts[:2])
    if len(parts) < 2:
        return None
    p = TOP.get(top, 'gov')
    if top == 'cps.pensions':
        if len(parts) < 3:
            return None
        sub = '.'.join(parts[:3])
        p = 'pensions' if sub == 'cps.pensions.pension' else 'gov' if sub == 'cps.pensions.pay' else 'benefits'
    return p


def type_of(n, purpose):
    if purpose in ('pensions', 'debt'):
        return 'past'
    if purpose == 'benefits':
        return 'people'
    chain, cur = [], n
    while cur:
        chain.append(cur)
        if cur['kind'] in ('spending_type', 'spend_type'):
            nm = cur['name']
            return 'people' if PEOPLE.search(nm) and not re.search(r'contract|suppl|grant|program', nm, re.I) else 'things'
        cur = nodes.get(cur['parent_id']) if cur.get('parent_id') else None
    if n['kind'] in ('job_title', 'pay_rate', 'position', 'job_title_group'):
        return 'people'
    for c in chain[:4]:
        nm = c['name']
        if re.search(r'third party benefit', nm, re.I):
            return 'things'
        pe, th = bool(PEOPLE.search(nm)), bool(THINGS.search(nm))
        if pe and not th:
            return 'people'
        if th:
            return 'things'
    return 'things'


TYPES = ('people', 'things', 'past')
leaf_type = {}
mix = collections.defaultdict(lambda: [0, 0, 0])  # signed cents by type, for every box
cells = collections.defaultdict(int)
for n in nodes.values():
    if not n['is_leaf'] or n['id'].startswith('city-twice'):
        continue
    p = purpose_of(n['id'])
    t = type_of(n, p)
    leaf_type[n['id']] = t
    cells[(n['root'], p, t)] += n['amount_cents']
    cur = n['id']
    ti = TYPES.index(t)
    while cur:
        mix[cur][ti] += n['amount_cents']
        cur = nodes[cur]['parent_id']
# budgeted positions in each box's subtree (positions and FTEs only, not hours or enrollees)
POS_UNITS = ('positions', 'full-time equivalents', 'positions (FTE)')
pos_sum = collections.defaultdict(float)
for n in nodes.values():
    if n['is_leaf'] and n.get('count') and (n.get('unit_label') or '') in POS_UNITS and not n['id'].startswith('city-twice'):
        cur = n['id']
        while cur:
            pos_sum[cur] += n['count']
            cur = nodes[cur]['parent_id']
totals = {g: nodes[g]['amount_cents'] for g in ('city', 'cps', 'parks')}
for g in totals:
    assert sum(v for (gg, _, _), v in cells.items() if gg == g) == totals[g], g
T = sum(totals.values())

purpose_members = collections.defaultdict(list)
for g in ('city', 'cps', 'parks'):
    for c in kids[g]:
        if c['id'] == 'cps.pensions':
            for cc in kids['cps.pensions']:
                purpose_members[purpose_of(cc['id'])].append(cc['id'])
        else:
            purpose_members[purpose_of(c['id'])].append(c['id'])

# ---------------------------------------------------------------- skeleton, depth-first
order = []
index = {}


def walk(nid, parent_idx):
    index[nid] = len(order)
    order.append((nid, parent_idx))
    me = index[nid]
    for c in kids[nid]:
        walk(c['id'], me)


sys.setrecursionlimit(10000)
for r in ROOTS:
    walk(r, -1)
assert len(order) == len(nodes)

kinds = sorted({n['kind'] for n in nodes.values()})
bases = sorted({n['basis'] or 'budget' for n in nodes.values()})
kind_i = {k: i for i, k in enumerate(kinds)}
basis_i = {b: i for i, b in enumerate(bases)}


def display_name(n):
    return n.get('short_name') or n['name']


skeleton = []
for nid, pidx in order:
    n = nodes[nid]
    seg = nid if pidx < 0 else nid[nid.rfind('.') + 1:]
    skeleton.append([seg, pidx, display_name(n), n['amount_cents'], kind_i[n['kind']], basis_i[n['basis'] or 'budget'],
                     1 if n['is_leaf'] else 0])

# ---------------------------------------------------------------- details
EXTRA_KEEP = ('fte', 'fte_2025', 'contract', 'contracts', 'payments', 'titles_in_group', 'enrollment_2024_25',
              'park_number', 'region', 'status', 'pdf_url', 'ward', 'midyear_group', 'also_on_other_lines',
              'interest_cents', 'principal_cents', 'final_maturity', 'fixed_rate', 'series', 'coupon_percent',
              'printed_total_cents', 'money_comes_from_cents', 'program_areas_cents')
PAY_KEEP = ('title', 'dept', 'n_paid_2025', 'regular_2025', 'overtime_2025', 'total_2025', 'budget_2026_positions',
            'budget_2026_avg_rate', 'median_total_excl_retro_fullyear', 'median_regular_fullyear',
            'mean_overtime_fullyear', 'pct_with_overtime_fullyear', 'n_total_excl_retro_fullyear')


def trim_extra(kind, x):
    if not isinstance(x, dict):
        return x if x not in (None, '', [], {}) else None
    if kind == 'pay_2025' and isinstance(x.get('group'), dict):
        g = {k: v for k, v in x['group'].items() if k in PAY_KEEP and v is not None}
        return {'group': g} if g else None
    out = {}
    for k, v in x.items():
        if v in (None, '', [], {}):
            continue
        if k == 'items' and isinstance(v, list):
            items = sorted((i for i in v if isinstance(i, dict)), key=lambda i: -abs(i.get('amount') or 0))
            out['items'] = [{kk: vv for kk, vv in i.items() if kk in ('vendor', 'amount', 'vouchers', 'people', 'is_individual', 'description')}
                            for i in items[:8]]
            if len(v) > 8:
                out['items_more'] = len(v) - 8
            continue
        if isinstance(v, list) and len(v) > 24:
            out[k] = v[:24]
            out[k + '_more'] = len(v) - 24
            continue
        if isinstance(v, dict) and len(json.dumps(v)) > 4000:
            continue
        out[k] = v
    return out or None


def compact_side(s):
    d = {'k': s.get('kind'), 'l': s.get('label')}
    if s.get('amount_cents') is not None:
        d['a'] = s['amount_cents']
    for src, dst in (('period', 'p'), ('basis', 'b'), ('section', 'sec')):
        if s.get(src):
            d[dst] = s[src]
    if isinstance(s.get('source'), int):
        d['s'] = s['source']
    x = trim_extra(s.get('kind'), s.get('extra'))
    if x:
        d['x'] = x
    return d


details = {}
for i, (nid, _) in enumerate(order):
    n = nodes[nid]
    d = {}
    if n.get('why'):
        d['w'] = n['why']
    if n.get('note'):
        d['n'] = n['note']
    if n.get('period_label'):
        d['pl'] = n['period_label']
    if n.get('count'):
        d['c'] = n['count']
        if n.get('unit_amount_cents') is not None:
            d['u'] = n['unit_amount_cents']
        if n.get('unit_label'):
            d['ul'] = n['unit_label']
        if n.get('formula_kind') and n['formula_kind'] != 'none':
            d['fk'] = n['formula_kind']
    if n.get('official_name') and n['official_name'] != n['name']:
        d['o'] = n['official_name']
    if n.get('short_name'):
        d['f'] = n['name']
    if n.get('caveats'):
        d['cv'] = n['caveats']
    if n.get('source') is not None:
        d['s'] = n['source']
    sd = [compact_side(s) for s in side(n)]
    if sd:
        d['sd'] = sd
    x = {k: v for k, v in (n.get('extra') or {}).items() if k in EXTRA_KEEP and v not in (None, '', [], {})}
    if x:
        d['x'] = x
    if pos_sum.get(nid):
        d['pos'] = round(pos_sum[nid], 1)
    if n['is_leaf'] and nid in leaf_type:
        d['ty'] = leaf_type[nid][0]
    elif nid in mix:
        d['ty'] = [round(v / 100) for v in mix[nid]]
    if d:
        details[i] = d

# ---------------------------------------------------------------- hero bubbles
MIN_BUBBLE, MIN_DRAWN = 12_000_000_00, 3_000_000_00
LABELS = {
    'Chicago Police Department': 'Police', "Municipal Employees' retirement fund": 'Municipal pensions',
    "Policemen's retirement fund": 'Police pensions', 'Charter and contract schools': 'Charter schools',
    'Pensions and Medicare tax': 'Teacher & staff pensions', 'Chicago Fire Department': 'Fire',
    'Employee health care and benefits': 'Employee health care', "Chicago O'Hare Airport Fund": 'O’Hare loans',
    'Water Management': 'Water', 'Family and Support Services': 'Family services',
    'Keeping school buildings clean and running': 'School buildings', 'Fleet and Facility Management': 'Fleet & facilities',
    "Firemen's retirement fund": 'Fire pensions', 'Bond Redemption and Interest Series Fund': 'City bond payments',
    'Independent schools network': 'Independent schools', 'Special education services': 'Special education',
    'Streets and Sanitation': 'Streets & sanitation', 'Facility Needs': 'School repairs', 'Water Fund': 'Water loans',
    'Getting kids to school (buses)': 'School buses',
    'Student health, counseling and college and career programs': 'Student health & counseling',
    'Grants, set-asides and savings targets': 'Grants & set-asides',
    'Education offices (teaching, learning, networks)': 'Education offices', 'Sewer Fund': 'Sewer loans',
    "Laborers' and Retirement Board retirement fund": 'Laborers’ pensions', 'Planning and Development': 'Planning',
    'Chicago Midway Airport Fund': 'Midway loans', 'Office of Public Safety Administration': 'Public safety admin',
    'Maintaining the parks': 'Park upkeep', 'IT, Security and Other Projects': 'School IT projects',
    'Chicago Public Library': 'Libraries', 'Preschool and early learning': 'Preschool',
    'Operations offices (technology, buying, families)': 'Operations offices',
    'Office of Emergency Management and Communications': '911 & emergencies', 'For Payment of Bonds': 'Other City bonds',
    'Soldier Field, harbors, golf and other managed venues': 'Soldier Field, harbors & golf',
    'Technology and Innovation': 'Technology', 'Cultural Affairs and Special Events': 'Culture & events',
    'Running the District': 'Park District offices', 'School safety and security': 'School safety',
    'Language programs, sports and stadiums': 'Languages & sports', 'Utilities, benefits and other shared costs': 'Park shared costs',
    'Business Affairs and Consumer Protection': 'Business affairs', 'Board, leadership and legal offices': 'Board & legal',
    'Hiring and people offices': 'Hiring offices', 'Museums and the zoo': 'Museums & the zoo',
    'Districtwide recreation programs': 'Recreation programs', 'Options network (alternative schools)': 'Options schools',
    'Board of Election Commissioners': 'Elections', 'Civilian Office of Police Accountability': 'Police accountability',
    'Salaries and payouts in this office': 'Pension office pay', 'Office of Inspector General': 'Inspector General',
}


def short(name):
    return re.sub(r'^Paid from: ', '', name).replace('Chicago Department of ', '').replace('Department of ', '')


def add_bubbles(parent_id, out, gov, expand=None, label_parent=None):
    small, small_kids = 0, []
    for c in kids[parent_id]:
        if expand and c['id'] in expand:
            add_bubbles(c['id'], out, gov, expand.get(c['id']), c['name'])
            continue
        if c['amount_cents'] <= 0:
            continue
        if c['amount_cents'] < MIN_BUBBLE:
            small += c['amount_cents']
            small_kids.append(c)
            continue
        out.append({'id': c['id'], 'name': short(c['name']), 'gov': gov, 'purpose': purpose_of(c['id']),
                    'amount': c['amount_cents'], 'parent': label_parent or nodes[parent_id]['name']})
    if small >= MIN_DRAWN:
        p = nodes[parent_id]
        if len(small_kids) == 1:
            c = small_kids[0]
            out.append({'id': c['id'], 'name': short(c['name']), 'gov': gov, 'purpose': purpose_of(c['id']),
                        'amount': c['amount_cents'], 'parent': label_parent or p['name']})
        else:
            label = {'parks': 'Other Park District costs', 'cps': 'Other school costs', 'city': 'Other City costs'}.get(parent_id, f'Other {short(p["name"]).lower()}')
            out.append({'id': parent_id, 'name': label, 'gov': gov, 'purpose': purpose_of(small_kids[0]['id']),
                        'amount': small, 'parent': label_parent or p['name'], 'other': len(small_kids)})


bubbles = []
for f in kids['city']:
    if f['amount_cents'] <= 0:
        continue
    if f['id'] in ('city.citywide', 'city.health'):
        bubbles.append({'id': f['id'], 'name': f['name'], 'gov': 'city', 'purpose': purpose_of(f['id']),
                        'amount': f['amount_cents'], 'parent': 'City of Chicago'})
    else:
        add_bubbles(f['id'], bubbles, 'city')
add_bubbles('cps', bubbles, 'cps', expand={'cps.schools': {'cps.schools.district-run': None}, 'cps.citywide': None,
                                           'cps.pensions': None, 'cps.central': None, 'cps.capital': None})
add_bubbles('parks', bubbles, 'parks', expand={'parks.parks-and-recreation': None})
for b in bubbles:
    if b['id'] == 'cps.debt':
        b['name'] = 'School loan payments'
    elif b['id'] == 'parks.paying-back-loans':
        b['name'] = 'Park District loans'
    elif b['id'] == 'parks.retirement-pensions':
        b['name'] = 'Park District pensions'
    elif re.fullmatch(r'Network \d+', b['name']):
        b['name'] += ' schools'
    b['label'] = LABELS.get(b['name'], re.sub(r'^(Office of |Department of )', '', b['name']))
    m = re.match(r'(\w+) Region \((\d+) parks\)', b['name'])
    if m:
        b['label'] = f'{m.group(1)} parks'

# ---------------------------------------------------------------- core extras
top_rows = []
for nid, _ in order:
    n = nodes[nid]
    if n['depth'] <= (2 if nid.startswith('city-twice') else 3):
        top_rows.append([nid, display_name(n), n['amount_cents'], n['kind'], 1 if n['is_leaf'] else 0, n['basis'] or 'budget'])

schools = []
for n in nodes.values():
    if n['kind'] == 'school':
        enr = next((s['extra'].get('count') for s in side(n) if s.get('kind') == 'enrollment'), None)
        schools.append([n['id'], n['name'], n['amount_cents'], enr, 'charter' if '.charter' in n['id'] else 'district'])
parks_list = [[n['id'], re.sub(r' \(park \d+\)$', '', n['name']), n['amount_cents'], (n['extra'] or {}).get('region')]
              for n in nodes.values() if n['kind'] == 'park']

pensions = []
for fund_id, label in [('city.retirement.policemen-s-annuity-and-benefit-fund', 'Police'),
                       ('city.retirement.firemen-s-annuity-and-benefit-fund', 'Fire'),
                       ('city.retirement.municipal-employees-annuity-and-benefit-fund', 'Municipal workers'),
                       ('city.retirement.laborers-and-retirement-board-annuity-and-benefi', 'Laborers')]:
    fund = next(n for nid, n in nodes.items() if nid.startswith(fund_id) and n['depth'] == 2)
    rec = {'fund': label, 'id': fund['id'], 'payment': fund['amount_cents']}
    for nid, n in nodes.items():
        if nid.startswith(fund_id):
            for s in side(n):
                if s.get('kind') == 'funded_ratio':
                    m = re.search(r'([\d.]+)%', s.get('label', ''))
                    rec['funded'] = (s.get('extra') or {}).get('ratio') or (float(m.group(1)) / 100 if m else None)
                    rec['as_of'] = s.get('period')
                if s.get('kind') == 'unfunded_liability' and s.get('amount_cents'):
                    rec['unfunded'] = s['amount_cents']
    pensions.append(rec)

titles = collections.defaultdict(lambda: [0.0, 0])
positions = collections.defaultdict(float)
for n in nodes.values():
    if n['root'] not in ('city', 'cps', 'parks') or not n['is_leaf'] or not n.get('count'):
        continue
    if (n.get('unit_label') or '') not in ('positions', 'full-time equivalents', 'positions (FTE)'):
        continue
    positions[n['root']] += n['count']
    t = nodes[n['parent_id']]['name'] if n['kind'] == 'pay_rate' and n['parent_id'] in nodes else n['name']
    t = re.sub(r'\s*\(.*?\)\s*$', '', t).strip()
    if t.startswith('Other job titles'):
        continue
    titles[(n['root'], t)][0] += n['count']
    titles[(n['root'], t)][1] += n['amount_cents']
jobs = [{'gov': g, 'title': t, 'count': round(c), 'amount': a}
        for (g, t), (c, a) in sorted(titles.items(), key=lambda x: -x[1][0])[:30]]

vendors = json.load(open(SRC / 'vendors.json'))
top_vendors = []
for v in sorted(vendors, key=lambda v: -v['totals'].get('city_2026_payments', 0))[:12]:
    links = []
    for r in v['rows']:
        if r['period'] == 'city_2026_payments':
            links += [x for x in (r.get('linked_node_ids') or []) if x in nodes]
    top_vendors.append({'name': v['payee_display'], 'amount': v['totals'].get('city_2026_payments', 0),
                        'amount_2025': v['totals'].get('city_2025', 0), 'link': links[0] if links else None})
individuals = json.load(open(SRC / 'vendors_individuals.json'))

resident = json.load(open(REPO / 'data/context_resident_2026.json'))
revenue = json.load(open(REPO / 'data/context_revenue_2026.json'))

# How Aviation is paid for: the airports' own funds versus grants (from each line's paying fund)
AV = 'city.infrastructure-services.chicago-department-of-aviation'
av_split = collections.Counter()
for n in nodes.values():
    if n['is_leaf'] and n['id'].startswith(AV + '.'):
        names = ' '.join([n['name']] + [nodes['.'.join(n['id'].split('.')[:i])]['name'] for i in range(3, len(n['id'].split('.')))])
        low = names.lower()
        key = 'airport' if re.search(r"o'hare airport money|midway airport money|airport fund|midway airport|o'hare international airport", low) else 'grants' if 'grant' in low else 'other'
        av_split[key] += n['amount_cents']
av_total = sum(av_split.values()) or 1
CPS_SMALL = ['cps.citywide.transportation', 'cps.citywide.food', 'cps.citywide.early-childhood']

past = sum(v for (g, p, t), v in cells.items() if t == 'past')
police_id = 'city.public-safety.chicago-police-department'
pps = sorted(a / e for _, _, a, e, _ in schools if e)
facts = {
    'total': T, 'per_second': T / 100 / 31_536_000, 'per_resident': T / 100 / POP, 'per_household': T / 100 / HOUSEHOLDS,
    'cps_per_student': totals['cps'] / 100 / STUDENTS, 'past': past, 'past_share': past / T,
    'police': nodes[police_id]['amount_cents'], 'police_share_city': nodes[police_id]['amount_cents'] / totals['city'],
    'police_overtime': sum(n['amount_cents'] for n in kids[police_id] if n['name'] == 'Overtime'),
    'unfunded_city_pensions': sum(p.get('unfunded') or 0 for p in pensions),
    'boxes': len(nodes), 'max_depth': max(n['depth'] for n in nodes.values()),
    'positions': {g: round(v) for g, v in positions.items()},
    'school_median_per_student': statistics.median(pps) / 100, 'n_schools': len(schools), 'n_parks': len(parks_list),
    'counted_twice': nodes['city-twice']['amount_cents'],
    'gross_city': manifest['gross_city_cents'], 'obm_adjustment': nodes['city.obm-unexplained']['amount_cents'],
    'cps_debt': nodes['cps.debt']['amount_cents'],
    'aviation_airport_share': av_split['airport'] / av_total, 'aviation_grant_share': av_split['grants'] / av_total,
    'cps_buses_meals_preschool': sum(nodes[i]['amount_cents'] for i in CPS_SMALL),
    'cps_buses_meals_preschool_names': [nodes[i]['name'] for i in CPS_SMALL],
}

core = {
    'meta': {'commit': manifest['commit'], 'run_at': manifest['run_at'], 'population': POP, 'households': HOUSEHOLDS,
             'students': STUDENTS, 'coverage': manifest['coverage'], 'periods': manifest['periods'],
             'chunk': CHUNK, 'nodes': len(nodes), 'bubble_min': MIN_BUBBLE, 'bubble_drawn': MIN_DRAWN},
    'govs': [
        {'id': 'city', 'name': 'City of Chicago', 'short': 'City', 'amount': totals['city'], 'period': 'Calendar year 2026'},
        {'id': 'cps', 'name': 'Chicago Public Schools', 'short': 'Schools', 'amount': totals['cps'], 'period': 'School year July 2025 to June 2026'},
        {'id': 'parks', 'name': 'Chicago Park District', 'short': 'Parks', 'amount': totals['parks'], 'period': 'Calendar year 2026'},
    ],
    'purposes': [{'id': i, 'name': nm, 'desc': d, 'members': purpose_members[i],
                  'amount': sum(v for (g, p, t), v in cells.items() if p == i),
                  'byGov': {g: sum(v for (gg, p, t), v in cells.items() if p == i and gg == g) for g in totals}}
                 for i, nm, d in PURPOSES],
    'types': [{'id': 'people', 'name': 'Pay & benefits for today’s workers'},
              {'id': 'things', 'name': 'Services, supplies & construction'},
              {'id': 'past', 'name': 'Pensions & debt'}],
    'cells': [[g, p, t, v] for (g, p, t), v in sorted(cells.items())],
    'bubbles': bubbles,
    'top': top_rows,
    'schools': schools,
    'parks': parks_list,
    'pensions': pensions,
    'jobs': jobs,
    'vendors2026': top_vendors,
    'individuals': individuals,
    'taxbill': resident['tax_bill']['group_share_of_bill'],
    'revenue': revenue['bucket_totals_all_local_funds'],
    'facts': facts,
}

# ---------------------------------------------------------------- sources & methods
sources = json.load(open(SRC / 'sources.json'))
KEEP_SRC = ('doc', 'dataset', 'name', 'url', 'url2', 'acfr_url', 'page', 'printed_page', 'line', 'note', 'cite')
sources = [({k: v for k, v in s.items() if k in KEEP_SRC and isinstance(v, (str, int, float))} if isinstance(s, dict) else {}) for s in sources]

gaps = json.load(open(SRC / 'gaps.json'))
use = collections.defaultdict(collections.Counter)
for n in nodes.values():
    src = n.get('source')
    for s in (src if isinstance(src, list) else [src]):
        if isinstance(s, int):
            use[n['root']][s] += 1
source_summary = {}
for root in ROOTS:
    rows, seen = [], set()
    for s, count in use[root].most_common():
        rec = sources[s] if s < len(sources) else {}
        label = rec.get('name') or rec.get('doc') or rec.get('dataset')
        if not label or label in seen:
            continue
        seen.add(label)
        rows.append({'label': label, 'url': rec.get('url'), 'boxes': count})
        if len(rows) >= 12:
            break
    source_summary[root] = rows
methods = {
    'coverage': manifest['coverage'],
    'gaps': {r: [{'id': g['id'], 'amount': g['amount_cents'], 'why': g.get('why'), 'path': g.get('path', [])[1:]}
                 for g in gaps.get(r, [])[:12]] for r in ROOTS},
    'sources': source_summary,
    'reconcile': {'net': totals['city'], 'twice': nodes['city-twice']['amount_cents'],
                  'obm': -nodes['city.obm-unexplained']['amount_cents'], 'gross': manifest['gross_city_cents']},
    'counts': manifest['counts'], 'run_at': manifest['run_at'], 'commit': manifest['commit'],
}

# ---------------------------------------------------------------- write
OUT.mkdir(parents=True, exist_ok=True)
for old in list(OUT.glob('*.json')) + list((OUT / 'details').glob('*.json')):
    old.unlink()
(OUT / 'details').mkdir(exist_ok=True)


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return path.stat().st_size


sizes = {
    'core.json': dump(OUT / 'core.json', core),
    'tree.json': dump(OUT / 'tree.json', {'kinds': kinds, 'bases': bases, 'chunk': CHUNK, 'nodes': skeleton}),
    'sources.json': dump(OUT / 'sources.json', sources),
    'methods.json': dump(OUT / 'methods.json', methods),
}
by_chunk = collections.defaultdict(dict)
for i, d in details.items():
    by_chunk[i // CHUNK][str(i)] = d
det = sum(dump(OUT / 'details' / f'{k}.json', v) for k, v in by_chunk.items())
print(f'{len(nodes):,} boxes · {len(bubbles)} bubbles · {len(by_chunk)} detail files')
for k, v in sizes.items():
    print(f'  {k:14s} {v / 1e6:6.2f} MB')
print(f'  details/       {det / 1e6:6.2f} MB')
print(f'  past share {past / T:.4f} · police {facts["police"] / 1e11:.3f}B · median per student {facts["school_median_per_student"]:,.0f}')
