import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';

const model=await readFile(new URL('../src/lib/sharePack.ts',import.meta.url),'utf8');
const chart=await readFile(new URL('../src/components/ShareChart.astro',import.meta.url),'utf8');
const page=await readFile(new URL('../src/pages/resources/index.astro',import.meta.url),'utf8');
const serializer=model.slice(model.indexOf('export function shareCsv'));
const js=ts.transpileModule(`const siteUrl='https://chicagobudget.com'; const href=(row)=>'/cps/box/'+row.id+'/';\n${serializer}`,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {shareCsv}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('share CSV preserves integer cents, quoted category names, period and stable box URL',()=>{
  const csv=shareCsv({period:'FY2026, July 2025 through June 2026',rows:[{id:'cps.schools',name:'Schools, "district-run"',amount_cents:12345,basis:'budget'}]});
  assert.match(csv,/"Schools, ""district-run"""/);
  assert.match(csv,/"12345"/);
  assert.match(csv,/"https:\/\/chicagobudget.com\/cps\/box\/cps.schools\/"/);
  assert.equal(csv.trimEnd().split('\n').length,2);
});
test('three independently scoped charts expose accessible exact tables and source/claim links',()=>{
  assert.match(model,/datasetEntries\.map/);
  assert.match(model,/children\(entry\.root\)/);
  assert.match(model,/sourceFor\(root\)/);
  assert.match(chart,/<svg[^>]*role="img"/);
  assert.match(chart,/<table>/);
  assert.match(chart,/href=\{href\(row\)\}/);
  assert.match(chart,/chart\.claimUrl/);
  assert.match(chart,/chart\.csvUrl/);
  assert.match(chart,/chart\.sources/);
  assert.match(page,/shareCharts\.map\(chart=>/);
  assert.match(page,/not actual spending/);
});
