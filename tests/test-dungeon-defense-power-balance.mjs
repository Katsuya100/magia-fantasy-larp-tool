// Symmetric power-duration regression: real combat against above-recommended enemies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel,enemyForFight} from '../assets/js/dungeon-design.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const base={hp:100,mag:10,def:7,res:7};
const styles=[
 {id:'none',attr:'flame',once:false,stones:0},
 {id:'flame',attr:'flame',once:false,stones:0},
 {id:'flame+5',attr:'flame',once:false,stones:5},
 {id:'flame+10',attr:'flame',once:false,stones:10},
 {id:'flame+20',attr:'flame',once:false,stones:20},
 {id:'flame+30',attr:'flame',once:false,stones:30},
 {id:'flame-once',attr:'flame',once:true,stones:0},
 {id:'storm-once',attr:'storm',once:true,stones:0},
 {id:'flame-once+5',attr:'flame',once:true,stones:5},
 {id:'flame-once+10',attr:'flame',once:true,stones:10}
];
const defensePower=mode=>strengthenedPower(270,mode.stones);
const spells=mode=>[
 {role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'bolt',power:420},
 {role:'attack',attribute:'gravity',power:540},
 {role:'support',attribute:'aqua',power:320},
 {role:'defense',attribute:mode.attr,power:defensePower(mode),basePower:270}
];
function enemyChoice(u,r){
 const ids=G.available(u);
 if(!ids.length)return -1;
 const heal=ids.find(i=>u.spells[i].role==='support');
 if(u.hp<u.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;
 const attacks=ids.filter(i=>u.spells[i].role==='attack');
 return attacks.length&&r()<num('enemy_attack_preference')
  ?attacks[Math.floor(r()*attacks.length)]:ids[Math.floor(r()*ids.length)];
}
function heroChoice(hero,enemy,style,casts){
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=ids.find(i=>hero.spells[i].role==='support');
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const attacks=ids.filter(i=>hero.spells[i].role==='attack');
 const best=attacks.sort((a,b)=>G.damage(hero,enemy,hero.spells[b],()=>.999)-G.damage(hero,enemy,hero.spells[a],()=>.999))[0];
 const expected=best===undefined?0:G.damage(hero,enemy,hero.spells[best],()=>.999);
 if(style.id!=='none'&&ids.includes(4)&&(!style.once||casts===0)&&!G.status(hero,'buff_'+style.attr)&&enemy.hp>expected)return 4;
 return best!==undefined?best:-1;
}
function play(seed,band,style){
 const r=rng(seed),hero=G.makeUnit(base,band.level,{},spells(style),'hero');
 const first=(band.from-1)*5+1,last=band.to*5;
 const result={cleared:first-1,turns:0,incoming:0,guards:0,foeGuards:0};
 for(let fight=first;fight<=last;fight++){
  const row=enemyForFight(data.enemies,fight);
  const enemy=G.fromEnemy(row,+data.floors[fight-1].enemy_level);
  let won=false,casts=0;
  for(let round=0;round<80;round++){
   const heroPick=heroChoice(hero,enemy,style,casts),enemyPick=enemyChoice(enemy,r);
   if(heroPick===4){result.guards++;casts++;}
   if(enemyPick>=0&&enemy.spells[enemyPick].role==='defense')result.foeGuards++;
   G.round(hero,enemy,heroPick,enemyPick,data.buffs,r,step=>{
    if(step.side==='enemy'&&(step.role==='attack'||step.role==='basic'))result.incoming+=step.amount;
   });
   result.turns++;
   if(hero.hp<=0)break;
   if(enemy.hp<=0){won=true;break;}
  }
  if(!won)break;
  result.cleared=fight;
  hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
  G.recoverVictoryMp(hero);
  if(fight%50===0&&fight<last){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;}
 }
 return {...result,win:result.cleared===last,hp:hero.hp,mp:hero.mp,maxHp:hero.stats.hp,maxMp:hero.maxMp};
}
const bands=[
 {id:'L4 Lv5',level:5,from:4,to:4},
 {id:'L4-5 Lv5',level:5,from:4,to:5},
 {id:'L12-13 Lv19',level:19,from:12,to:13},
 {id:'L22-23 Lv37',level:37,from:22,to:23},
 {id:'L31-32 Lv55',level:55,from:31,to:32},
 {id:'L71-72 Lv115',level:115,from:71,to:72},
 {id:'L91-92 Lv139',level:139,from:91,to:92}
];
const formulas=[
 {id:'constant2',base:2,cap:2,step:0},
 {id:'constant3',base:3,cap:3,step:0},
 {id:'constant4',base:4,cap:4,step:0},
 {id:'power200',base:2,cap:6,step:200},
 {id:'power250',base:2,cap:6,step:250},
 {id:'power300',base:2,cap:6,step:300}
];
const results=[],samples=96;
for(const formula of formulas){
 const balance=data.balance.map(row=>({...row}));
 for(const [key,value] of [['resistance_buff_duration',formula.base],['defense_duration_base',formula.base],['defense_duration_cap',formula.cap],['defense_duration_power_step',formula.step]]){
  const row=balance.find(x=>x.key===key);assert.ok(row);row.value=String(value);
 }
 configure({...data,balance});
 for(const [power,duration] of [[50,formula.base],[168,formula.base],[270,Math.min(formula.cap,formula.base+(formula.step>0?Math.floor(270/formula.step):0))],[540,Math.min(formula.cap,formula.base+(formula.step>0?Math.floor(540/formula.step):0))],[1000,Math.min(formula.cap,formula.base+(formula.step>0?Math.floor(1000/formula.step):0))]]){
  assert.equal(G.defenseDuration({power}),duration,formula.id+' P'+power);
 }
 for(const band of bands){
  assert.ok(targetClearLevel(band.from)>band.level,'challenge must be above recommended player level '+band.id);
  for(const style of styles){
   const runs=Array.from({length:samples},(_,i)=>play(3179+i*47,band,style));
   const avg=k=>Math.round(runs.reduce((a,x)=>a+x[k],0)/runs.length*10)/10;
   const wins=runs.filter(x=>x.win);
   const res={formula:formula.id,challenge:band.id,style:style.id,power:defensePower(style),
    heroDefenseDuration:G.defenseDuration({power:defensePower(style)}),enemyTypicalDuration:G.defenseDuration({power:120}),
    samples,winRate:Math.round(1000*wins.length/samples)/10,cleared:avg('cleared'),
    turns:avg('turns'),incoming:avg('incoming'),guards:avg('guards'),enemyGuards:avg('foeGuards'),
    hpOnWin:wins.length?Math.round(wins.reduce((a,x)=>a+x.hp/x.maxHp,0)/wins.length*100):null,
    mpOnWin:wins.length?Math.round(wins.reduce((a,x)=>a+x.mp/x.maxMp,0)/wins.length*100):null};
   results.push(res);
   console.log('POWER_DEFENSE_BALANCE '+JSON.stringify(res));
  }
 }
}
for(const band of bands)for(const style of styles){
 const old=results.find(x=>x.formula==='constant4'&&x.challenge===band.id&&x.style===style.id);
 const next=results.find(x=>x.formula==='power250'&&x.challenge===band.id&&x.style===style.id);
 console.log('POWER_DEFENSE_DELTA '+JSON.stringify({challenge:band.id,style:style.id,
  four:old.winRate,power250:next.winRate,points:Math.round((next.winRate-old.winRate)*10)/10,
  clearedChange:Math.round((next.cleared-old.cleared)*10)/10}));
}
assert.equal(results.length,formulas.length*bands.length*styles.length);
assert.ok(results.every(x=>Number.isFinite(x.cleared)&&x.winRate>=0&&x.winRate<=100));
console.log('PASS paired above-level defense-duration power simulation with UGC and stone upgrades');
