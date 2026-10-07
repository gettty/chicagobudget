import {children, href, sourceFor} from './data';
import {datasetEntries, exportDate, required, siteUrl} from './discovery';

export const shareCharts = datasetEntries.map(entry => {
  const root = required(entry.root);
  const rows = children(entry.root).filter(node => node.amount_cents > 0).sort((a,b) => b.amount_cents-a.amount_cents);
  const sources = sourceFor(root).filter(source => typeof source.url === 'string' && /^https:\/\//.test(source.url)).map(source => ({url:String(source.url),label:String(source.name || source.doc || source.dataset || 'Official source')}));
  if (!rows.length || !sources.length) throw new Error(`Share chart ${entry.slug} needs rows and official root citations`);
  return {slug:entry.slug,title:`${entry.name}: top-level categories`,period:entry.period,qualification:entry.qualification,root,rows,sources,exportDate,claimUrl:`${siteUrl}/resources/#${entry.slug}-categories`,datasetUrl:`/datasets/2026/${entry.slug}/`,csvUrl:`/resources/${entry.slug}-categories.csv`,rootUrl:href(root)};
});
export function shareCsv(chart:typeof shareCharts[number]) {
  const escape = (value:string) => `"${value.replaceAll('"','""')}"`;
  return ['id,category,amount_cents,basis,period,box_url',...chart.rows.map(row => [row.id,row.name,String(row.amount_cents),row.basis || '',chart.period,`${siteUrl}${href(row)}`].map(escape).join(','))].join('\n')+'\n';
}
