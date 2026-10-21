// Diagnostic only: real 32-seed, item-free Lv150 expeditions through 90-100F.
// Exactly the same earned-stone loadout, HP/MP carry-over and combat engine as
// test-dungeon-progression-simulation.mjs. No synthetic recovery or extra gear.
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {simulate} from '../tests/test-dungeon-progression-simulation.mjs';
const rows=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
const configurations=[
 {mag:1,bossMag:1},{mag:.65,bossMag:1},{mag:.68,bossMag:1},
 {mag:.7,bossMag:1},{mag:.72,bossMag:1},{mag:.75,bossMag:1},
 {mag:.78,bossMag:1},{mag:.8,bossMag:1},{mag:.85,bossMag:1},
 {mag:.65,bossMag:1.15},{mag:.65,bossMag:1.3},
 {mag:.7,bossMag:1.15},{mag:.7,bossMag:1.3},
 {mag:.72,bossMag:1.15},{mag:.72,bossMag:1.3},
 {mag:.75,bossMag:1.15},{mag:.75,bossMag:1.3},
 {mag:.78,bossMag:1.15},{mag:.78,bossMag:1.3},
 {mag:.8,bossMag:1.15},{mag:.8,bossMag:1.3}
];
for(const candidate of configurations){
 const master=rows.map(row=>{
  const floor=Number(row.id.match(/_l(\d+)(?:_|$)/)?.[1]||0);
  if(floor<91||floor>100)return row;
  const isFinalBoss=row.id==='boss_l100';
  return {...row,mag:String(Math.max(1,Math.round(Number(row.mag)*candidate.mag*(isFinalBoss?candidate.bossMag:1))))};
 });
 const runs=Array.from({length:32},(_,i)=>simulate(17011+i*13,{
  level:150,fromLayer:90,toLayer:100,spells:'five',stones:'earned',enemyMaster:master
 }));
 const wins=runs.filter(x=>x.win);
 const mean=arr=>arr.length?Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*1000)/10:null;
 const losses=Object.entries(runs.filter(x=>!x.win).reduce((a,x)=>{
  const key=Math.ceil((x.clear+1)/5);a[key]=(a[key]||0)+1;return a;
 },{}));
 console.log('TUNING_ITEM_FREE '+JSON.stringify({
  ...candidate,wins:wins.length,winRate:100*wins.length/32,
  hp:mean(wins.map(x=>x.hp/x.initialHp)),
  mp:mean(wins.map(x=>x.mp/x.initialMp)),losses
 }));
}
console.log('PASS diagnostic 32-seed legal item-free 90-100F combat probes');
