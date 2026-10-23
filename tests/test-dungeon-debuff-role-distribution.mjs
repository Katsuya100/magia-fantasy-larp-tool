// Regression for flavor-selected curse specialists in all ten-layer bands.
// Compare actual casts and enemy encounters with the previous all-caster
// baseline (same 128 seeds; 75% of repeat-sortie earned stones).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {simulate} from './test-dungeon-progression-simulation.mjs';
import {simulateProgression} from '../scripts/simulate-dungeon-stones.mjs';
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const expectedSlots={
 20:[1,5],21:[4,5],22:[1,5],23:[3,5],24:[2,5],25:[1,4],26:[4,5],27:[3,5],28:[3,5],29:[3,5],30:[1,5],
 31:[3,5],32:[1,4],33:[1,5],34:[1,5],35:[1,5],36:[2,3],37:[1,5],38:[1,5],39:[1,5],40:[3,5],
 41:[3,5],42:[1,4],43:[3,5],44:[4,5],45:[1,5],46:[1,5],47:[3,5],48:[3,4],49:[3,5],50:[3,5],
 51:[3,5],52:[3,5],53:[3,5],54:[1,5],55:[1,3],56:[1,5],57:[1,5],58:[1,5],59:[3,5],60:[3,5],
 61:[3,5],62:[1,5],63:[4,5],64:[3,4],65:[1,5],66:[1,5],67:[2,5],68:[1,5],69:[3,5],70:[2,5],
 71:[3,5],72:[3,5],73:[3,5],74:[4,5],75:[1,5],76:[2,5],77:[1,5],78:[3,5],79:[4,5],80:[1,5],
 81:[2,4],82:[2,5],83:[1,5],84:[2,5],85:[2,3],86:[4,5],87:[3,5],88:[1,5],89:[3,5],90:[4,5],
 91:[3,5],92:[1,2],93:[1,5],94:[1,5],95:[4,5],96:[2,5],97:[2,4],98:[3,5],99:[2,5],100:[4,5]
};
assert.equal(Object.keys(expectedSlots).length,81);
for(let layer=1;layer<=100;layer++){
 const group=data.enemies.slice((layer-1)*5,layer*5);
 const real=[];
 for(let i=0;i<group.length;i++){
  const row=group[i],spells=row.spells.split('|');
  assert.equal(spells.length,5);
  const curses=spells.filter(s=>s.startsWith('debuff:'));
  if(curses.length)real.push(i+1);
  assert.ok(curses.length<=1);
  if(layer>=20&&!curses.length)assert.equal(spells[3].split(':')[0],'defense',
    'non-specialists use an ordinary defense spell instead of their curse');
 }
 assert.deepEqual(real,layer<20?[]:expectedSlots[layer],'flavor specialist assignment at layer '+layer);
}
assert.equal(num('enemy_debuff_specialist_preference'),.27);
// Prior all-caster config, matched to identical combat/75%-stone conditions.
const previous={
 10:{casts:0,encounters:0},20:{casts:1.05,encounters:2.0},
 30:{casts:8.30,encounters:16.0},40:{casts:9.13,encounters:17.5},
 50:{casts:9.71,encounters:18.6},60:{casts:10.78,encounters:20.1},
 70:{casts:10.84,encounters:20.4},80:{casts:11.57,encounters:21.3},
 90:{casts:12.43,encounters:22.8},100:{casts:13.30,encounters:23.8}
};
const levels={10:19,20:37,30:55,40:72,50:87,60:102,70:115,80:128,90:139,100:150};
const count=128,earned=Array.from({length:count},(_,i)=>simulateProgression(17011+i*13+81));
for(let to=10;to<=100;to+=10){
 const from=to-9,level=levels[to];
 let casts=0,affected=0,reached=0,wins=0;
 for(let i=0;i<count;i++){
  const previousCheckpoint=from-1;
  const stones=previousCheckpoint===0?0:earned[i].milestones.find(x=>x.layer===previousCheckpoint).stones;
  const result=simulate(17011+i*13,{level,fromLayer:from,toLayer:to,spells:'five',stones:Math.floor(stones*.75)});
  casts+=result.enemyDebuffCasts;
  affected+=result.enemyDebuffFights;
  reached+=result.fightsReached;
  wins+=Number(result.win);
 }
 const meanCasts=casts/count,encounters=affected/reached*100,old=previous[to];
 const stats={from,to,count,meanCasts:Math.round(meanCasts*100)/100,
  encountersPercent:Math.round(encounters*10)/10,
  beforeCasts:old.casts,beforeEncounters:old.encounters,
  winRate:Math.round(wins/count*1000)/10};
 console.log('DEBUFF_ROLE_DECADE '+JSON.stringify(stats));
 assert.ok(meanCasts>=old.casts,
  'debuff casts must not fall below original all-caster baseline at '+from+'-'+to);
 assert.ok(encounters>=old.encounters,
  'probability of facing a debuff must not fall below original at '+from+'-'+to);
}
console.log('PASS flavor-driven two-specialist allocation and preserved decade debuff frequency');
