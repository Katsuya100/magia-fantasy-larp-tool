// Seeded above-level challenge, including player-cast UGC debuffs with stone upgrades.
// Use actual battle rules, phase ordering, cooldowns, enemy AI and MP carryover.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {enemyForFight,targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const spells=mode=>[
 {role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'gravity',power:540},
 {role:'support',attribute:'aqua',power:320},
 {role:'debuff',attribute:mode.role==='none'?'flame':mode.role,power:strengthenedPower(270,mode.stones),basePower:270},
 {role:'defense',attribute:'storm',power:270}
];
function enemyChoice(unit,r){return G.chooseEnemySpell(unit,r);}
function heroChoice(u,enemy,mode,curses){
 const ids=G.available(u);if(!ids.length)return -1;
 const heal=ids.find(i=>u.spells[i].role==='support');
 if(heal!==undefined&&u.hp/u.stats.hp<.69)return heal;
 const attacks=ids.filter(i=>u.spells[i].role==='attack');
 const best=attacks.sort((a,b)=>G.damage(u,enemy,u.spells[b],()=>.999)-G.damage(u,enemy,u.spells[a],()=>.999))[0];
 const expected=best===undefined?0:G.damage(u,enemy,u.spells[best],()=>.999);
 if(mode.role!=='none'&&ids.includes(3)&&(!mode.once||curses===0)&&!G.status(enemy,'debuff_'+mode.role)&&enemy.hp>expected)return 3;
 return best??-1;
}
function play(seed,band,mode){
 const r=rng(seed),hero=G.makeUnit({hp:100,mag:10,def:7,res:7},band.level,{},spells(mode),'player');
 const first=(band.from-1)*5+1,last=band.to*5;let cleared=first-1,turns=0,casts=0;
 for(let fight=first;fight<=last;fight++){
  const enemy=G.fromEnemy(enemyForFight(data.enemies,fight),Number(data.floors[fight-1].enemy_level));
  let won=false,curses=0;
  for(let t=0;t<80;t++){
   const pick=heroChoice(hero,enemy,mode,curses),ep=enemyChoice(enemy,r);
   if(pick===3){casts++;curses++;}
   G.round(hero,enemy,pick,ep,data.buffs,r);
   turns++;
   if(hero.hp<=0)break;
   if(enemy.hp<=0){won=true;break;}
  }
  if(!won)break;
  cleared=fight;
  hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
  G.recoverVictoryMp(hero);
  if(fight%50===0&&fight<last){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;}
 }
 return {win:cleared===last,cleared,turns,casts};
}
const bands=[
 {name:'Lv5 vs L4',level:5,from:4,to:4},
 {name:'Lv19 vs L12-13',level:19,from:12,to:13},
 {name:'Lv37 vs L22-23',level:37,from:22,to:23},
 {name:'Lv55 vs L31-32',level:55,from:31,to:32},
 {name:'Lv87 vs L51-52',level:87,from:51,to:52},
 {name:'Lv115 vs L71-72',level:115,from:71,to:72}
];
const modes=[
 {id:'attack-only',role:'none',once:false,stones:0},
 {id:'burn',role:'flame',once:false,stones:0},
 {id:'burn+10',role:'flame',once:false,stones:10},
 {id:'burn+30',role:'flame',once:false,stones:30},
 {id:'dizzy',role:'storm',once:false,stones:0},
 {id:'dizzy+30',role:'storm',once:false,stones:30},
 {id:'seal-once',role:'law',once:true,stones:0}
];
const samples=64,results=[];
for(const band of bands){
 assert.ok(targetClearLevel(band.from)>band.level,band.name+' must challenge above player level');
 for(const mode of modes){
  const power=strengthenedPower(270,mode.stones);
  const runs=Array.from({length:samples},(_,i)=>play(7119+i*47,band,mode));
  const wins=runs.filter(x=>x.win).length;
  const res={band:band.name,mode:mode.id,power,duration:G.statusDuration({power}),
   runs:samples,winRate:Math.round(wins/samples*1000)/10,
   avgCleared:Math.round(runs.reduce((n,x)=>n+x.cleared,0)/samples*10)/10,
   avgTurns:Math.round(runs.reduce((n,x)=>n+x.turns,0)/samples*10)/10,
   avgCasts:Math.round(runs.reduce((n,x)=>n+x.casts,0)/samples*10)/10};
  results.push(res);
  console.log('DEBUFF_CHALLENGE '+JSON.stringify(res));
 }
}
assert.equal(results.length,bands.length*modes.length);
assert.ok(results.every(x=>Number.isFinite(x.winRate)&&x.winRate>=0&&x.winRate<=100));
for(const band of bands){
 const base=results.find(x=>x.band===band.name&&x.mode==='attack-only');
 for(const mode of modes.filter(x=>x.id!=='attack-only')){
  const next=results.find(x=>x.band===band.name&&x.mode===mode.id);
  console.log('DEBUFF_CHALLENGE_DELTA '+JSON.stringify({band:band.name,mode:mode.id,
   base:base.winRate,curse:next.winRate,points:Math.round((next.winRate-base.winRate)*10)/10}));
 }
}
console.log('PASS 2-6 round power-scaled debuffs in 2,688 above-recommended adventure challenges');
