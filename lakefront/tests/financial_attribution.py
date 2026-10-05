"""Regression checks for Lakefront's financial attribution. Run: python3 -m unittest discover -s lakefront/tests -p 'financial*.py'."""
import glob
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT.parent / 'data/public/2026/site'


class FinancialAttribution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = {n['id']: n for path in glob.glob(str(EXPORT / 'chunks/*.json'))
                     for n in json.loads(Path(path).read_text())['nodes']}
        cls.core = json.loads((ROOT / 'public/data/core.json').read_text())

    def test_pension_office_pay_is_government_not_healthcare(self):
        amount = self.nodes['cps.pensions.pay']['amount_cents']
        self.assertEqual(amount, 1_485_021_791)
        by_purpose = {p['id']: p for p in self.core['purposes']}
        self.assertIn('cps.pensions.pay', by_purpose['gov']['members'])
        self.assertNotIn('cps.pensions.pay', by_purpose['benefits']['members'])
        pay_leaves = sum(n['amount_cents'] for n in self.nodes.values()
                         if n['is_leaf'] and n['id'].startswith('cps.pensions.pay.'))
        self.assertEqual(pay_leaves, amount)
        self.assertGreaterEqual(by_purpose['gov']['byGov']['cps'], amount)

    def test_aviation_shares_use_signed_leaves_and_midway_overtime(self):
        av = 'city.infrastructure-services.chicago-department-of-aviation'
        split = dict.fromkeys(('airport', 'grants', 'other'), 0)
        for n in self.nodes.values():
            if not n['is_leaf'] or not n['id'].startswith(av + '.'):
                continue
            parts = n['id'].split('.')
            names = ' '.join([n['name']] + [self.nodes['.'.join(parts[:i])]['name']
                                            for i in range(3, len(parts))]).lower()
            key = ('airport' if re.search(r"o'hare airport money|midway airport money|airport fund|midway airport|o'hare international airport", names)
                   else 'grants' if 'grant' in names else 'other')
            split[key] += n['amount_cents']
        self.assertLess(self.nodes[av + '.pay-for-workers.0610-chicago-midway-airport-fund.0610-2010-0005.budgeted-turnover-vacancy-savings-chicago-midway']['amount_cents'], 0)
        self.assertEqual(self.nodes[av + '.overtime.0610-2010-0020']['amount_cents'], 460_685_400)
        self.assertAlmostEqual(self.core['facts']['aviation_airport_share'], split['airport'] / sum(split.values()))
        self.assertAlmostEqual(self.core['facts']['aviation_grant_share'], split['grants'] / sum(split.values()))
        # Fixed export expectations catch a shared mistake in the calculation above and the builder.
        self.assertAlmostEqual(self.core['facts']['aviation_airport_share'], 0.5513320312, places=9)
        self.assertAlmostEqual(self.core['facts']['aviation_grant_share'], 0.4486679688, places=9)

    def test_side_fact_cites_its_own_source(self):
        tree = json.loads((ROOT / 'public/data/tree.json').read_text())['nodes']
        target = ('city.infrastructure-services.chicago-department-of-aviation.pay-for-workers.'
                  '0740-chicago-o-hare-airport-fund.0740-2015-0005.'
                  'chicago-o-hare-international-airport.7020-general-manager-of-airport-operations')
        ids = []
        for segment, parent, *_ in tree:
            ids.append(segment if parent < 0 else ids[parent] + '.' + segment)
        index = ids.index(target)
        detail = json.loads((ROOT / 'public/data/details' / f'{index // 400}.json').read_text())
        record = detail[str(index % 400)] if str(index % 400) in detail else detail[str(index)]
        self.assertEqual(record['s'], 299)
        self.assertTrue(any(s.get('s') == 1 for s in record['sd']))
        rail = (ROOT / 'src/atlas/rail.js').read_text()
        self.assertRegex(rail, r'Number\.isInteger\(s\.s\)[\s\S]*?sourceLine\(all\[s\.s\]\)')
        self.assertIn('facts(d.sd, n, t)', rail)


if __name__ == '__main__':
    unittest.main()
