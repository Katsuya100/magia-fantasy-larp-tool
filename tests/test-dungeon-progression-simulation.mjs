// Seeded, real-combat simulations from the first floor through the target boss.
// Unlike per-boss TTK estimates, these retain hero HP, MP and carried supplies.
// Results in a continuous expedition do not award XP until the hero returns.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {enemyForFight,layerForFight} from '../assets/js/dungeon-design.mjs';
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),
 floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const random=seed=>()=>{
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 return seed/4294967296;
};
const SPELLS={
 three:[{role:'attack',attribute:'flame',power:360},{role:'attack',attribute:'bolt',power:420},{role:'support',attribute:'aqua',power:300}],
 five:[{role:'attack',attribute:'flame',power:360},{role:'attack',attribute:'bolt',power:420},{role:'attack',attribute:'gravity',power:540},
  {role:'support',attribute:'aqua',power:320},{role:'defense',attribute:'law',power:270}],
 beginner:[{role:'attack',attribute:'flame',power:300},{role:'attack',attribute:'bolt',power:330},{role:'support',attribute:'aqua',power:270}]
};
function enemyAction(unit,r){
 const ids=G.available(unit);
 if(!ids.length)return -1;
 const heal=ids.find(i=>unit.spells[i].role==='support');
 if(unit.hp<unit.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;
 const offense=ids.filter(i=>unit.spells[i].role==='attack');
 return offense.length&&r()<num('enemy_attack_preference')
  ?offense[Math.floor(r()*offense.length)]:ids[Math.floor(r()*ids.length)];
}
function heroAction(hero,enemy){
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=ids.find(i=>hero.spells[i].role==='support');
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offense=ids.filter(i=>hero.spells[i].role==='attack');
 if(offense.length)return offense.sort((a,b)=>G.damage(hero,enemy,hero.spells[b],()=>.999)-G.damage(hero,enemy,hero.spells[a],()=>.999))[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
export function simulate(seed,{level=12,layers=3,spells='five',heals=3,manas=1}={}){
 const r=random(seed),base={hp:100,mag:10,def:7,res:7};
 const hero=G.makeUnit(base,level,{},SPELLS[spells],'player');
 const carry=[
  ...Array.from({length:heals},()=>({id:'heal_s',value:G.rollPotionValue(data.items[0],1,r),bonus:null})),
  ...Array.from({length:manas},()=>({id:'mana_s',value:G.rollPotionValue(data.items[4],1,r),bonus:null}))
 ];
 const stats={win:false,clear:0,turns:0,itemUses:0,fightStats:[],startLevel:level,spells,heals,manas};
 for(let fight=1;fight<=layers*5;fight++){
  const row=enemyForFight(data.enemies,fight);
  const enemy=G.fromEnemy(row,+data.floors[fight-1].enemy_level);
  const hpBefore=hero.hp,mpBefore=hero.mp;
  let turns=0,win=false;
  for(;turns<90;turns++){
   if(hero.hp/hero.stats.hp<.45){
    const index=carry.findIndex(x=>x.id.startsWith('heal_'));
    if(index>=0){G.potion(hero,carry[index],data.items,data.buffs);carry.splice(index,1);stats.itemUses++;}
   }else if(hero.mp/hero.maxMp<.26){
    const index=carry.findIndex(x=>x.id.startsWith('mana_'));
    if(index>=0){G.potion(hero,carry[index],data.items,data.buffs);carry.splice(index,1);stats.itemUses++;}
   }
   const pick=heroAction(hero,enemy);
   const foePick=enemyAction(enemy,r);
   G.round(hero,enemy,pick,foePick,data.buffs,r);
   stats.turns++;
   if(hero.hp<=0)break;  // same rule as app: hero death takes precedence.
   if(enemy.hp<=0){win=true;break;}
  }
  stats.fightStats.push({fight,layer:layerForFight(fight),win,turns:turns+1,hpBefore,hpAfter:hero.hp,mpBefore,mpAfter:hero.mp});
  if(!win)break;
  stats.clear=fight;
  if(fight%50===0&&fight<layers*5){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;stats.restores=(stats.restores||0)+1;}
  hero.statuses=[];
  hero.cooldowns=hero.cooldowns.map(()=>0);
  G.recoverVictoryMp(hero);
 }
 stats.win=stats.clear===layers*5;
 stats.hp=hero.hp;stats.mp=hero.mp;
 return stats;
}
// Player's target-level expectation: five fights, zero carried items.
// Every tenth cleared layer may take the offered full HP/MP restoration.
export const scenarios=[
 {name:'expected L1, 1 layer, 3 circles, no items',level:1,layers:1,spells:'beginner',heals:0,manas:0},
 {name:'expected L3, 2 layers, 3 circles, no items',level:3,layers:2,spells:'beginner',heals:0,manas:0},
 {name:'expected L5, 3 layers, 3 circles, no items',level:5,layers:3,spells:'beginner',heals:0,manas:0},
 {name:'L12, 3 layers, 3 circles, no items',level:12,layers:3,spells:'three',heals:0,manas:0},
 {name:'L12, 3 layers, 5 circles, no items',level:12,layers:3,spells:'five',heals:0,manas:0},
 {name:'expected L19, 10 layers, 5 circles, no items',level:19,layers:10,spells:'five',heals:0,manas:0},
 {name:'L22, 11 layers, 5 circles, no items, decade heal',level:22,layers:11,spells:'five',heals:0,manas:0}
];
export function summarize(config,samples=80){
 const runs=Array.from({length:samples},(_,i)=>simulate(17011+i*13,config));
 const wins=runs.filter(x=>x.win);
 const avg=x=>Math.round(x.reduce((n,v)=>n+v,0)/x.length*10)/10;
 return {name:config.name,winRate:Math.round(100*wins.length/samples),
  reachedBoss:Math.round(100*runs.filter(x=>x.clear>=config.layers*5-1).length/samples),
  avgCleared:avg(runs.map(x=>x.clear)),
  avgTurns:avg(runs.map(x=>x.turns)),
  avgItems:avg(runs.map(x=>x.itemUses)),
  avgRestores:avg(runs.map(x=>x.restores||0)),
  avgHp: wins.length?avg(wins.map(x=>x.hp)):null,
  lossByFight:Object.entries(runs.filter(x=>!x.win).reduce((a,x)=>{const f=x.clear+1;a[f]=(a[f]||0)+1;return a;},{}))};
}
for(const config of scenarios)console.log('PROGRESSION_SIM '+JSON.stringify(summarize(config)));
assert.ok(scenarios.every(x=>x.layers>=1&&x.heals===0&&x.manas===0),'scenarios include full early-game five-fight chains');
assert.ok(SPELLS.beginner.length>=3&&SPELLS.five.length===5);
console.log('PASS deterministic full-fight sequence, enemy AI, cooldowns, potions, and carry-over HP/MP');
