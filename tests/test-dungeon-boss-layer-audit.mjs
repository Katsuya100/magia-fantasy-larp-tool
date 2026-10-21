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
  for(const point of res.checkpoints){
   const s=floorStats[point.layer-71];
   s[k].push(point.hp);s[k==='old'?'mpOld':'mpNow'].push(point.mp);
   s[k==='old'?'roundsOld':'roundsNow'].push(point.rounds);
  }
 }
}
const avg=x=>x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*10)/10:null;
for(const row of floorStats){
 assert.ok(row.old.length>110,'historical run reaches floor '+row.layer);
 assert.ok(row.now.length>110,'adjusted run reaches floor '+row.layer);
 console.log('BOSS_LAYER_AUDIT '+JSON.stringify({floor:row.layer,reached:{old:row.old.length,new:row.now.length},
 hp:{old:avg(row.old),new:avg(row.now)},
 mp:{old:avg(row.mpOld),new:avg(row.mpNow)},
 rounds:{old:avg(row.roundsOld),new:avg(row.roundsNow)}}));
}
console.log('PASS paired boss layer audit 71-80F');
