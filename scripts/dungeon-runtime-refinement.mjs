// Read-only 128-seed candidate sweep using the shipped combat and item rules.
// Never alters official acceptance thresholds or adds recovery/items.
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {deepRun} from '../tests/test-dungeon-deep-cleanse-simulation.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
const median=values=>{if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),n=v.length;return (v[Math.floor((n-1)/2)]+v[Math.floor(n/2)])/2;};
const round=x=>x===null?null:Math.round(x*10)/10;
const candidates=[];
const range={hp:[.78,.8,.82,.84,.85,.86],mag:[.83,.84,.85,.86],boss:[1.9,2,2.1,2.2,2.3]};
for(const hp of range.hp)for(const mag of range.mag)for(const boss of range.boss){
 const balance=data.balance.map(row=>({...row,value:row.key==='enemy_hp_band_81'?String(hp):
   row.key==='enemy_mag_band_81'?String(mag):row.key==='enemy_mag_boss_81'?String(boss):row.value}));
 configure({...data,balance});
 const runs=Array.from({length:128},(_,i)=>deepRun(17011+i*13,{from:81,to:90,level:139},true));
 const wins=runs.filter(x=>x.win);
 const rate=round(wins.length/128*100),midHp=round(median(wins.map(x=>100*x.hp/x.maxHp))),midMp=round(median(wins.map(x=>100*x.mp/x.maxMp)));
 const valid=rate>=90&&rate<=97&&midHp!==null&&midHp>=72.4&&midHp<=82.4&&midMp>=4.2&&midMp<=14.2;
 const gap=(v,lo,hi)=>Math.max(0,lo-v,v-hi);
 const score=round(gap(rate,90,97)*4+gap(midHp,72.4,82.4)*1.5+gap(midMp,4.2,14.2)*3);
 candidates.push({hp,mag,boss,rate,midHp,midMp,valid,score});
}
candidates.sort((a,b)=>b.valid-a.valid||a.score-b.score||Math.abs(a.hp-.85)+Math.abs(a.mag-.85)-Math.abs(b.hp-.85)-Math.abs(b.mag-.85));
console.log('RUNTIME_REFINEMENT '+JSON.stringify({total:candidates.length,valid:candidates.filter(x=>x.valid).length,top:candidates.slice(0,24)}));
console.log('PASS 128-seed candidate sweep; no assertion weakening');
