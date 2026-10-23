// Additional economy diagnostics only: 101-150F has no equivalent authored
// opponent/encounter design. Conditional all-win drop *projections* MUST NOT
// be interpreted as observed success rates or as inventory grants.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {bossDropsMagicInk} from '../assets/js/dungeon-ink.mjs';
import {upgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {runJourney,rng,spread} from './simulate-dungeon-journeys.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
const VERSION='dungeon-economy-additional-v1';
export function extrapolatedStoneAndInk(samples=256,seed=20261024){
 const bands=Array.from({length:5},(_,i)=>({from:101+i*10,to:110+i*10,stone:[],ink:[]}));
 const totals={stone:[],ink:[]};
 for(let i=0;i<samples;i++){
  const random=rng(seed+i*7919),c={stone:0,ink:0};
  for(const band of bands){
   let stone=0,ink=0;
   for(let layer=band.from;layer<=band.to;layer++)for(let slot=1;slot<=5;slot++){
    const enemyLevel=targetClearLevel(layer);
    stone+=G.dropCounts(enemyLevel,random,{playerLevel:150,layer,firstClear:false}).stone;
    if(slot===5&&bossDropsMagicInk('conditional-boss',random))ink++;
   }
   c.stone+=stone;c.ink+=ink;band.stone.push(stone);band.ink.push(ink);
  }
  totals.stone.push(c.stone);totals.ink.push(c.ink);
 }
 return {samples,seed,assumption:'Conditional every-fight victory, existing stone and boss-ink rolls; NO combat victory/rank or reward banking simulated',
  aboveAuthoredLayer:100,source:'G.dropCounts + bossDropsMagicInk',
  checkpointCurves:[100,110,120,130,140,150,151].map(layer=>({layer,
   stoneChance:G.magicStoneDropChance(150,layer),enemyLevel:targetClearLevel(layer)})),
  bands:bands.map(({from,to,stone,ink})=>({from,to,fights:50,stone:spread(stone),ink:spread(ink)})),
  totalFights:250,totals:{stone:spread(totals.stone),ink:spread(totals.ink)},
  upgradePriceAfter20:upgradeStoneCost(20),upgradePriceAfter60:upgradeStoneCost(60),
  upgradePriceAfter100:upgradeStoneCost(100)};
}
export function alchemyComparisons(samples=8,seed=20261024){
 const rows=[];
 for(const style of ['A','C'])for(const route of ['short','long']){
  const pairs=[];
  for(let i=0;i<samples;i++){
   const s=seed+7919*i;
   const no=runJourney(s,{style,route,alchemy:false});
   const yes=runJourney(s,{style,route,alchemy:true});
   pairs.push({seed:s,without:{best:no.best,earned:no.earned,spent:no.spent,losses:no.losses,
     fights:no.fights,returns:no.returns,balances:no.balances},
    with:{best:yes.best,earned:yes.earned,spent:yes.spent,losses:yes.losses,
     fights:yes.fights,returns:yes.returns,balances:yes.balances},
    crafts:yes.alchemyCrafts,byproducts:yes.alchemyByproducts,
    stoneDifference:yes.earned.stone-no.earned.stone,inkDifference:yes.earned.ink-no.earned.ink});
  }
  rows.push({style,route,samples,
   crafts:spread(pairs.map(x=>x.crafts)),
   byproductStones:spread(pairs.map(x=>x.byproducts.stone)),
   byproductInk:spread(pairs.map(x=>x.byproducts.ink)),
   totalStoneDifference:spread(pairs.map(x=>x.stoneDifference)),
   totalInkDifference:spread(pairs.map(x=>x.inkDifference)),
   battlesDifference:spread(pairs.map(x=>x.with.fights-x.without.fights)),
   pairSamples:pairs});
 }
 return {samples,seed,source:'actual collection and five consumable instances, real craftAlchemy rules after return',
  allocation:'optional diagnosis only; ordinary progression never relies on crafts',
  pairs:rows};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report={schemaVersion:VERSION,layer101To150:extrapolatedStoneAndInk(),alchemy:alchemyComparisons(8)};
 mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
 writeFileSync(new URL('../reports/dungeon-extra-diagnostics-v1.json',import.meta.url),
  JSON.stringify(report,null,2)+'\n');
 console.log('DUNGEON_EXTRA_DIAGNOSTICS '+JSON.stringify({version:VERSION,
  layer101To150Stone:report.layer101To150.totals.stone,
  layer101To150Ink:report.layer101To150.totals.ink,
  alchemy:report.alchemy.pairs.map(({style,route,crafts,byproductStones,byproductInk,battlesDifference})=>
   ({style,route,crafts,byproductStones,byproductInk,battlesDifference}))}));
 const md=['## 101–150F: extrapolated resource income (NOT combat clearance)',
  'Assuming 250 won encounters: stones '+JSON.stringify(report.layer101To150.totals.stone)+
  '; inks '+JSON.stringify(report.layer101To150.totals.ink)+'.',
  'Alchemy is a separate reference-only paired diagnosis; no crafting used in mandatory combat.'];
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n');
}
