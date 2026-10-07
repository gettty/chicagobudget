import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dirname,'..');
const data=join(root,'public/data');
const manifest=JSON.parse(readFileSync(join(data,'manifest.json'),'utf8'));
const spine=JSON.parse(readFileSync(join(data,'spine.json'),'utf8'));
const sources=JSON.parse(readFileSync(join(data,'sources.json'),'utf8'));
const catalog=JSON.parse(readFileSync(join(root,'../data/public/2026/catalog.json'),'utf8'));
const html=(path)=>readFileSync(join(root,'dist',path,'index.html'),'utf8');
const id=(value)=>spine.find(node=>node.id===value);
const currency=(cents)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const jsonld=(text)=>[...text.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match=>JSON.parse(match[1].replaceAll('&quot;','"')));

test('guide export has eleven distinct, sourced and fully rendered answers',()=>{
 const slugs=['city-adopted-budget','net-versus-gross','police-budget','fire-budget','overtime-budget','pensions-and-debt','cps-fiscal-year','school-budgets','parks-budget','per-resident','gaps-and-estimates'];
 for(const slug of slugs){const page=html(`guides/${slug}`);assert.match(page,/<h1>/);assert.match(page,/<table>/);assert.match(page,/Primary sources/);assert.match(page,/not one official consolidated City budget/);assert.match(page,/data\.cityofchicago\.org|cps\.edu|chicagoparkdistrict\.com/);assert.match(page,new RegExp(manifest.run_at.slice(0,10)));}
 assert.match(html('guides'),/2026 budget guides/);
 for(const [slug,nodeId] of [['city-adopted-budget','city'],['police-budget','city.public-safety.chicago-police-department'],['fire-budget','city.public-safety.chicago-fire-department'],['overtime-budget','city.public-safety.chicago-police-department.overtime'],['cps-fiscal-year','cps'],['parks-budget','parks']]) assert.ok(html(`guides/${slug}`).includes(currency(id(nodeId).amount_cents)),`${slug} must use exported ${nodeId} cents`);
 assert.ok(html('guides/net-versus-gross').includes(currency(manifest.gross_city_cents)));
 assert.match(html('guides/per-resident'),/not what any resident owes/);
 assert.match(html('guides/pensions-and-debt'),/not the total pension liability/);
});

test('catalog and three dataset pages expose real JSON downloads, provenance and version',()=>{
 const listing=html('datasets');const catalogSchema=jsonld(listing).find(schema=>schema['@type']==='DataCatalog');assert.ok(catalogSchema);assert.equal(catalogSchema.dataset.length,3);
 const checksum=catalog.files.find(file=>file.path==='tree/manifest.json').sha256;
 for(const [gov,sourceUrl] of [['city',sources[297].url],['cps',sources[3931].url],['parks',sources[3794].url]]){
  const page=html(`datasets/2026/${gov}`),schema=jsonld(page).find(value=>value['@type']==='Dataset');assert.ok(schema,gov);
  assert.equal(schema.version,manifest.commit);assert.equal(schema.dateModified,manifest.run_at.slice(0,10));assert.equal(schema.isBasedOn[0],sourceUrl);assert.ok(schema.distribution.every(download=>download['@type']==='DataDownload'&&download.contentUrl.startsWith('https://raw.githubusercontent.com/gettty/chicagobudget/main/data/public/2026/')));
  for(const distribution of schema.distribution)assert.ok(existsSync(join(root,'../data/public/2026',distribution.name)),distribution.name);
  assert.match(page,/integer cents/);assert.ok(page.includes(currency(id(gov).amount_cents)));assert.ok(page.includes(sourceUrl.replaceAll('&','&amp;')));assert.ok(page.includes(checksum));assert.ok(existsSync(join(root,`../data/public/2026/tree/${gov}/_root.json`)));
 }
 assert.equal(catalogSchema.dataset[0]['@type'],'Dataset');assert.doesNotMatch(listing,/"license":"https?:/);
});
