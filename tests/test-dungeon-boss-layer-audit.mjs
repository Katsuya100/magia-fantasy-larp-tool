// Paired, deterministic per-floor boss difficulty telemetry for late-game sorties.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {deepRun} from './test-dungeon-deep-cleanse-simulation.mjs';
const original=G.parseCsv(readFileSync(new URL('./fixtures/dungeon-enemies-pre-boss.csv',import.meta.url),'utf8'));
const samples=128;
const median=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n),n=a.length;return Math.round((a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2*10)/10;};
const p10=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n);return Math.round(a[Math.floor(.1*(a.length-1))]*10)/10;};
const p90=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n);return Math.round(a[Math.floor(.9*(a.length-1))]*10)/10;};
const avg=x=>x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10:null;
for(const band of [{from:71,to:80,level:128},{from:91,to:100,level:150}]){
 const floors=Array.from({length:10},(_,i)=>({floor:band.from+i,old:[],now:[],mpOld:[],mpNow:[],wins:{old:0,new:0}}));
 for(let i=0;i<samples;i++){
  const seed=17011+i*13,previous=deepRun(seed,band,true,original),now=deepRun(seed,band,true);
  floors[9].wins.old+=Number(previous.win);floors[9].wins.new+=Number(now.win);
  for(const [res,k] of [[previous,'old'],[now,'now']])for(const p of res.layerStats.filter(x=>x.cleared)){
   const item=floors[p.layer-band.from];
   item[k].push(p.endHp/res.maxHp*100);item[k==='old'?'mpOld':'mpNow'].push(p.endMp/res.maxMp*100);
  }
 }
 for(const row of floors){
  assert.ok(row.old.length>110,'old run reaches floor '+row.floor);
  assert.ok(row.now.length>110,'new run reaches floor '+row.floor);
  console.log('BOSS_LAYER_AUDIT '+JSON.stringify({floor:row.floor,reached:{old:row.old.length,new:row.now.length},
   hp:{old:avg(row.old),new:avg(row.now),medianOld:median(row.old),medianNew:median(row.now),p10Old:p10(row.old),p10New:p10(row.now),p90Old:p90(row.old),p90New:p90(row.now)},
   mp:{old:avg(row.mpOld),new:avg(row.mpNow),medianOld:median(row.mpOld),medianNew:median(row.mpNow)},
   wins:row.wins}));
 }
}
console.log('PASS paired boss layer audit 71-80F and 91-100F');

// Diagnostic sweep of only boss100 HP; enemy spells, resistance, party loadout, and seeds stay fixed.
const live=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
for(const hp of [86,90,94,98,101,103,105,106,107,108,109,110,111,112,113,114,115,116,118,120]){
 const catalog=[...live],boss={...catalog[499],hp:String(hp)};catalog[499]=boss;
 const results=Array.from({length:128},(_,i)=>deepRun(17011+i*13,{from:91,to:100,level:150},true,catalog));
 const winners=results.filter(x=>x.win);
 const rates=winners.map(x=>x.hp/x.maxHp*100),mp=winners.map(x=>x.mp/x.maxMp*100);
 console.log('BOSS_100_HP_SWEEP '+JSON.stringify({hp,wins:winners.length,winRate:winners.length/128*100,
  medianHP:median(rates),meanHP:avg(rates),medianMP:median(mp)}));
}
