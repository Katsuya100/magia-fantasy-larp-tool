// Diagnostic search over REAL 128-seed sorties. Does not alter game data or test thresholds.
// Run via Actions to compare authored catalog HP/MAG candidates against the full combat logic.
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {simulate} from '../tests/test-dungeon-progression-simulation.mjs';
import {deepRun} from '../tests/test-dungeon-deep-cleanse-simulation.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
import {durabilityArchetype,durabilityRanges} from './dungeon-enemy-durability-rules.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const enemies=csv('enemies');
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
const histories=Array.from({length:128},(_,i)=>simulateProgression(17011+i*13+81).milestones);
const LEVELS={1:19,11:37,21:55,31:72,41:87,51:102,61:115,71:128,81:139,91:150};
const OLD={
  1:[100,56.9,73.2],11:[100,11.8,71.7],21:[96.1,5.7,73.9],
  31:[97.7,13.6,72.8],41:[96.1,8.3,73.5],51:[100,7.2,79.1],
  61:[100,9.5,80.2],71:[100,8.9,79.4],81:[100,9.2,77.4],91:[94.5,2.8,80.5]
};
const median=values=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),n=v.length;return (v[Math.floor((n-1)/2)]+v[Math.floor(n/2)])/2;};
const rounded=n=>n===null?null:Math.round(n*10)/10;
function trialRows(start,hpScale,magScale,scope){
 const end=start+9;
 return enemies.map(row=>{
  const l=Number(row.id.match(/_l(\d+)(?:_|$)/)?.[1]);
  if(!(l>=start&&l<=end))return row;
  if(scope==='last2'&&l<end-1)return row;
  if(scope==='last3'&&l<end-2)return row;
  if(scope==='boss'&&row.boss_only!=='1')return row;
  const kind=durabilityArchetype(row.name);
  const range=durabilityRanges[row.boss_only==='1'?'boss':'normal'][kind];
  const hp=Math.max(range.hp[0],Math.min(range.hp[1],Math.round(Number(row.hp)*hpScale)));
  return {...row,hp:String(hp),mag:String(Math.max(1,Math.round(Number(row.mag)*magScale)))};
 });
}
function measure(start,rows){
 const runs=[];
 for(let i=0;i<128;i++){
  const seed=17011+i*13,band={from:start,to:start+9,level:LEVELS[start]};
  if(start>=51){
   const x=deepRun(seed,band,true,rows);
   runs.push({win:x.win,hp:100*x.hp/x.maxHp,mp:100*x.mp/x.maxMp});
  }else{
   const prev=start-1;
   const stones=prev===0?0:histories[i].find(x=>x.layer===prev)?.stones;
   if(stones==null)throw Error('missing stone record');
   const rate=start===1?.25:start===11?.3:.75;
   const x=simulate(seed,{level:LEVELS[start],fromLayer:start,toLayer:start+9,
    spells:start===1?'intro':'five',stones:Math.floor(stones*rate+1e-8),enemyMaster:rows});
   runs.push({win:x.win,hp:100*x.hp/x.initialHp,mp:100*x.mp/x.initialMp});
  }
 }
 const wins=runs.filter(x=>x.win);
 return {win:rounded(100*wins.length/128),hp:rounded(median(wins.map(x=>x.hp))),mp:rounded(median(wins.map(x=>x.mp)))};
}
function rank(start,measured){
 const [oldWin,oldMp,oldHp]=OLD[start];
 const winLo=start<=11?99:90,winHi=start<=11?100:97,mpLo=start===1?50:0,mpHi=start===1?100:15;
 if(measured.hp===null)return 1e6;
 const outside=(x,a,b)=>Math.max(0,a-x,x-b);
 const gap=outside(measured.win,winLo,winHi),hp=outside(measured.hp,oldHp-5,oldHp+5),mp=outside(measured.mp,Math.max(mpLo,oldMp-5),Math.min(mpHi,oldMp+5));
 return Math.round((gap*4+hp*1.5+mp*3)*10)/10;
}
const bands=(process.env.PROBE_BANDS||'11,21,41,51,61,71,81,91').split(',').map(Number);
const hps=(process.env.PROBE_HP||'0.72,0.85,1,1.15').split(',').map(Number);
const mags=(process.env.PROBE_MAG||'0.65,0.8,0.95,1.1').split(',').map(Number);
const scopes=(process.env.PROBE_SCOPES||'whole,last3').split(',');
for(const start of bands){
 const initial=measure(start,enemies);
 console.log('TUNING_BASELINE '+JSON.stringify({band:start+'-'+(start+9),...initial,score:rank(start,initial)}));
 const found=[];
 for(const scope of scopes)for(const hpScale of hps)for(const magScale of mags){
  if(hpScale===1&&magScale===1)continue;
  const result=measure(start,trialRows(start,hpScale,magScale,scope));
  found.push({scope,hpScale,magScale,...result,score:rank(start,result)});
 }
 found.sort((a,b)=>a.score-b.score||Math.abs(1-a.hpScale)+Math.abs(1-a.magScale)-Math.abs(1-b.hpScale)-Math.abs(1-b.magScale));
 console.log('TUNING_PROBE '+JSON.stringify({band:start+'-'+(start+9),top:found.slice(0,8),tested:found.length}));
}
console.log('PASS diagnostic candidate search (does not relax or replace official tests)');
