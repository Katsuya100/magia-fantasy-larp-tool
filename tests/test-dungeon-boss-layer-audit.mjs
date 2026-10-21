// Paired, deterministic per-floor traces for the difficulty-sensitive 71-80F.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {deepRun} from './test-dungeon-deep-cleanse-simulation.mjs';
const original=G.parseCsv(readFileSync(new URL('./fixtures/dungeon-enemies-pre-boss.csv',import.meta.url),'utf8'));
const band={from:71,to:80,level:128},samples=128;
const floorStats=Array.from({length:10},(_,i)=>({layer:i+71,old:[],now:[],mpOld:[],mpNow:[],roundsOld:[],roundsNow:[]}));
for(let i=0;i<samples;i++){
 const seed=17011+i*13,previous=deepRun(seed,band,true,original),now=deepRun(seed,band,true);
 for(const [res,k] of [[previous,'old'],[now,'now']]){
  for(const point of res.layerStats.filter(x=>x.cleared)){
   const s=floorStats[point.layer-71];
   s[k].push(point.endHp/res.maxHp*100);s[k==='old'?'mpOld':'mpNow'].push(point.endMp/res.maxMp*100);
   // Layer end HP/MP is recorded after victory MP restoration.
  }
 }
}
const median=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n),n=a.length;return Math.round((a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2*10)/10;};
const p10=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n);return Math.round(a[Math.floor(.1*(a.length-1))]*10)/10;};
const p90=x=>{if(!x.length)return null;const a=[...x].sort((m,n)=>m-n);return Math.round(a[Math.floor(.9*(a.length-1))]*10)/10;};
const avg=x=>x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10:null;
for(const row of floorStats){
 assert.ok(row.old.length>110,'historical run reaches floor '+row.layer);
 assert.ok(row.now.length>110,'adjusted run reaches floor '+row.layer);
 console.log('BOSS_LAYER_AUDIT '+JSON.stringify({floor:row.layer,reached:{old:row.old.length,new:row.now.length},
 hp:{old:avg(row.old),new:avg(row.now),medianOld:median(row.old),medianNew:median(row.now),p10Old:p10(row.old),p10New:p10(row.now),p90Old:p90(row.old),p90New:p90(row.now)},
 mp:{old:avg(row.mpOld),new:avg(row.mpNow),medianOld:median(row.mpOld),medianNew:median(row.mpNow)},
 rounds:{old:avg(row.roundsOld),new:avg(row.roundsNow)}}));
}
console.log('PASS paired boss layer audit 71-80F');
