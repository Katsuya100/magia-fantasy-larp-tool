// Optional 1/2/3-circle redraw stress, with no invented ink or refund of
// original stone upgrades. Forced low-quality swaps are counterfactual risk
// diagnostics, not recommended behavior or hidden help for mandatory combat.
import {writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {runJourney,spread} from './simulate-dungeon-journeys.mjs';
const report={version:'dungeon-portfolio-redraw-v1',seed:20261024,samples:16,
 assumptions:{art:'same owned original drawing quality, 5 real inks per replaced circle',
 investment:'past upgrades sunk; new circle starts at upgrade 0',
 forced:'1-3 diagnostic replacements can cost more than continuation; not a universal best choice',
 alchemy:false},combinations:[],warnings:[]};
for(const route of ['short','long'])for(const limit of [1,2,3]){
 const runs=Array.from({length:report.samples},(_,i)=>runJourney(
  report.seed+7919*i,{style:'C',route,redrawLimit:limit,forceRedraw:true}));
 const row={route,requestedRedraws:limit,samples:report.samples,
  attempted:runs.length,completed:runs.filter(x=>x.best===100).length,
  realized:spread(runs.map(x=>x.replacements)),
  sunkCircles:spread(runs.map(x=>x.sunkCircles)),
  sunkStones:spread(runs.map(x=>x.redrawEvents.reduce((a,b)=>a+b.sunkStones,0))),
  inkSpent:spread(runs.map(x=>x.spent.ink)),
  totalStoneEarned:spread(runs.map(x=>x.earned.stone)),
  totalStoneSpent:spread(runs.map(x=>x.spent.stone)),
  bankStone:spread(runs.map(x=>x.balances.stone)),
  p90ReturnCount:spread(runs.map(x=>x.returns)).p90,
  p90FightCount:spread(runs.map(x=>x.fights)).p90,
  p90Defeats:spread(runs.map(x=>x.losses)).p90,
  neverGrantedInk:runs.every(x=>x.earned.ink===x.spent.ink+x.balances.ink),
  neverGrantedStone:runs.every(x=>x.earned.stone===x.spent.stone+x.balances.stone),
  examples:runs.slice(0,2).map(x=>({seed:x.seed,events:x.redrawEvents,
   best:x.best,rank:x.profile.rank,level:x.profile.level,blockers:x.blockers}))};
 if(!row.neverGrantedInk||!row.neverGrantedStone||runs.some(x=>x.replacements>limit))
  throw Error('Conservation failed in redraw comparison');
 report.combinations.push(row);
 console.log('DUNGEON_PORTFOLIO_REDRAW '+JSON.stringify({...row,examples:undefined}));
}
const incomplete=report.combinations.filter(x=>x.realized.p10<x.requestedRedraws);
if(incomplete.length)report.warnings.push('Some scenarios did not find enough usable 5-ink redraw opportunities; do not infer hypothetical ink stock.');
report.warnings.push('Forced redraw is a diagnostic of lost stone investment; not an optimal C strategy or approved win-rate test.');
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-portfolio-redraw-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## 1–3 circle replacement stress (actual owned ink)\n'+
 report.combinations.map(x=>x.route+' / '+x.requestedRedraws+' redraws: realized p10/50/90 '+
 [x.realized.p10,x.realized.median,x.realized.p90].join('/')+
 '; sunk-stone median '+x.sunkStones.median+
 '; 100F reaches '+x.completed+'/'+x.samples+'\n').join('')+
 '\nForced redraw cases can be unprofitable. No battle victory target is relaxed.\n');
console.log('DUNGEON_PORTFOLIO_REDRAW_SUMMARY '+JSON.stringify({status:'DIAGNOSTIC',
 combinations:report.combinations.length,warnings:report.warnings}));
