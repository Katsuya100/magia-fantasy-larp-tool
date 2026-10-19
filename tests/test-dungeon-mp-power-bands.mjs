// Hypothetical MP surcharge comparison: no changes are deployed to players.
// Each band is a consecutive fight sequence with carried HP/MP, actual enemies,
// original-power upgrade pricing, victory recovery and decade checkpoints.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {simulate,scenarios} from './test-dungeon-progression-simulation.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
const originalBalance=data.balance.map(row=>({...row}));
const SAMPLES=32;
// step = 0 disables the surcharge; threshold = 500.
// +1 MP per 200/125/80 points above 500 are comparison hypotheses.
const proposals=[
 {id:'current',step:0},
 {id:'gentle',step:200},
 {id:'moderate',step:125},
 {id:'strong',step:80}
];
const profiles=['existing','max500','one1000','all800','all1000'];
const clone=s=>({...s});
function spellLoadout(config,profile){
 if(profile==='existing')return null;
 const starter=config.spells!=='five';
 const base=starter
  ?[{role:'attack',attribute:'flame',power:config.spells==='beginner'?300:360},
    {role:'attack',attribute:'bolt',power:config.spells==='beginner'?330:420},
    {role:'support',attribute:'aqua',power:config.spells==='beginner'?270:300}]
  :[{role:'attack',attribute:'flame',power:360},
    {role:'attack',attribute:'bolt',power:420},
    {role:'attack',attribute:'gravity',power:540},
    {role:'support',attribute:'aqua',power:320},
    {role:'defense',attribute:'law',power:270}];
 const spells=base.map(clone),attacks=spells.filter(s=>s.role==='attack');
 if(profile==='max500'){
  attacks.forEach((s,i)=>s.power=[500,460,490][i]);
 }else if(profile==='one1000'){
  attacks[0].power=1000;
 }else if(profile==='all800'){
  attacks.forEach((s,i)=>s.power=[800,720,640][i]);
 }else if(profile==='all1000'){
  attacks.forEach((s,i)=>s.power=[1000,900,800][i]);
 }else throw Error('Unknown profile '+profile);
 return spells;
}
const round1=v=>Math.round(v*10)/10;
function evaluate(band,profile){
 const equipment=spellLoadout(band,profile);
 const runs=Array.from({length:SAMPLES},(_,i)=>simulate(17011+i*13,{...band,spellLoadout:equipment}));
 const wins=runs.filter(r=>r.win);
 const avg=(xs,f)=>xs.length?round1(xs.reduce((n,r)=>n+f(r),0)/xs.length):null;
 return {
  level:band.level,from:band.fromLayer,to:band.toLayer,band:band.name,
  profile,attempts:SAMPLES,success:wins.length,winRate:round1(wins.length*100/SAMPLES),
  avgLastFight:avg(runs,r=>r.clear),
  avgRounds:avg(runs,r=>r.turns),
  avgBasicAttacks:avg(runs,r=>r.normalAttacks),
  hpOnWin:avg(wins,r=>100*r.hp/r.initialHp),
  mpOnWin:avg(wins,r=>100*r.mp/r.initialMp),
  mpAllRuns:avg(runs,r=>100*r.mp/r.initialMp),
  avgMpRestored:avg(runs,r=>r.mpRestored),
  avgStoneBudget:avg(runs,r=>r.spentStones)
 };
}
for(const proposal of proposals){
 const balance=originalBalance.map(row=>({...row}));
 const step=balance.find(row=>row.key==='mp_cost_high_power_step');
 assert.ok(step);
 step.value=String(proposal.step);
 configure({...data,balance});
 // Below the threshold must remain exactly the same under every proposal.
 for(const power of [100,300,400,500]){
  const expected=2+Math.ceil(G.basePower(power)/12);
  assert.equal(G.mpCost(power),expected,proposal.id+' should preserve low power '+power);
 }
 for(const power of [400,500,600,800,1000]){
  const upgraded={role:'attack',attribute:'flame',power:power*2,basePower:power};
  assert.equal(G.spellMpCost(upgraded),G.mpCost(power),'upgrades retain original MP pricing');
 }
 const prices=Object.fromEntries([300,400,500,600,800,1000,1200].map(p=>[p,G.mpCost(p)]));
 console.log('MP_PROPOSAL_COST '+JSON.stringify({proposal:proposal.id,step:proposal.step,prices}));
 for(const band of scenarios){
  for(const profile of profiles)
   console.log('MP_BAND_RESULT '+JSON.stringify({proposal:proposal.id,...evaluate(band,profile)}));
 }
}
configure({...data,balance:originalBalance});
console.log('PASS 15 level bands x 5 realistic loadouts x 4 MP proposals x 32 seeded full fight runs, with actual base-power upgrade pricing');
