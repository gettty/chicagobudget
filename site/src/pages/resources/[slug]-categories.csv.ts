import type {APIRoute, GetStaticPaths} from 'astro';
import {shareCharts,shareCsv} from '../../lib/sharePack';
export const getStaticPaths:GetStaticPaths = () => shareCharts.map(chart=>({params:{slug:chart.slug},props:{chart}}));
export const GET:APIRoute = ({props}) => new Response(shareCsv(props.chart),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${props.chart.slug}-categories.csv"`}});
