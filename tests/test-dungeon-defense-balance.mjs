// Historical two-turn resistance vs current power-scaled 2–6 turns, same for debuffs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {enemyForFight,targetClearLevel} from '../assets/js/dungeon-design.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const spells=mode=>[
 {role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'bolt',power:420},
 {role:'attack',attribute:'gravity',power:540},
 {role:'support',attribute:'aqua',power:320},
 {role:'defense',attribute:mode.startsWith('flame')?'flame':'storm',power:270}
];
const base={hp:100,mag:10,def:7,res:7};
function enemyChoice(u,r){
 const ids=G.available(u);if(!ids.length)return -1;
 const heal=ids.find(i=>u.spells[i].role==='support');
 if(u.hp<u.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;
 const attacks=ids.filter(i=>u.spells[i].role==='attack');
 return attacks.length&&r()<num('enemy_attack_preference')
  ?attacks[Math.floor(r()*attacks.length)]:ids[Math.floor(r()*ids.length)];
}
function heroChoice(hero,enemy,mode,guardCasts){
 const ids=G.available(hero);if(!ids.length)return -1;
 const heal=ids.find(i=>hero.spells[i].role==='support');
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offenses=ids.filter(i=>hero.spells[i].role==='attack');
 const best=offenses.sort((a,b)=>G.damage(hero,enemy,hero.spells[b],()=>.999)-G.damage(hero,enemy,hero.spells[a],()=>.999))[0];
 const expected=best===undefined?0:G.damage(hero,enemy,hero.spells[best],()=>.999);
 if(mode!=='none'&&ids.includes(4)&&(!mode.endsWith('-once')||guardCasts===0)&&!G.status(hero,'buff_'+(mode.startsWith('flame')?'flame':'storm'))&&enemy.hp>expected)return 4;
 if(best!==undefined)return best;
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
function play(seed,config,mode,buffs){
 const r=rng(seed),hero=G.makeUnit(base,config.level,{},spells(mode),'hero');
 const first=(config.from-1)*5+1,last=config.to*5;
 const result={cleared:first-1,turns:0,incoming:0,outgoing:0,guards:0,foeGuards:0};
 for(let fight=first;fight<=last;fight++){
  const foe=enemyForFight(data.enemies,fight);
  const enemy=G.fromEnemy(foe,+data.floors[fight-1].enemy_level);
  let win=false,guardCasts=0;
  for(let turn=0;turn<80;turn++){
   const hp=heroChoice(hero,enemy,mode,guardCasts),ep=enemyChoice(enemy,r);
   if(hp===4){result.guards++;guardCasts++;}
   if(ep>=0&&enemy.spells[ep].role==='defense')result.foeGuards++;
   G.round(hero,enemy,hp,ep,buffs,r,step=>{
    if(step.side==='enemy'&&(step.role==='attack'||step.role==='basic'))result.incoming+=step.amount;
    if(step.side==='hero'&&(step.role==='attack'||step.role==='basic'))result.outgoing+=step.amount;
   });
   result.turns++;
   if(hero.hp<=0)break;
   if(enemy.hp<=0){win=true;break;}
  }
  if(!win)break;
  result.cleared=fight;
  hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
  G.recoverVictoryMp(hero);
  if(fight%50===0&&fight<last){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;}
 }
 return {...result,win:result.cleared===last,hp:hero.hp,mp:hero.mp,maxHp:hero.stats.hp,maxMp:hero.maxMp};
}
// Test expeditions STARTING in enemy layers above the player's level.
// Unlike target-level showcases these are challenge runs with no consumables.
const bands=[
 {name:'Lv1 vs L2',level:1,from:2,to:2},
 {name:'Lv5 vs L4',level:5,from:4,to:4},
 {name:'Lv5 vs L4-5',level:5,from:4,to:5},
 {name:'Lv19 vs L12-13',level:19,from:12,to:13},
 {name:'Lv35 vs L22-23',level:35,from:22,to:23},
 {name:'Lv36 vs L22-23',level:36,from:22,to:23},
 {name:'Lv37 vs L21-22',level:37,from:21,to:22},
 {name:'Lv37 vs L22-23',level:37,from:22,to:23},
 {name:'Lv38 vs L22-23',level:38,from:22,to:23},
 {name:'Lv39 vs L22-23',level:39,from:22,to:23},
 {name:'Lv55 vs L31-32',level:55,from:31,to:32},
 {name:'Lv87 vs L51-52',level:87,from:51,to:52},
 {name:'Lv115 vs L71-72',level:115,from:71,to:72},
 {name:'Lv139 vs L91-92',level:139,from:91,to:92}
];
for(const band of bands){
 const minimum=targetClearLevel(band.from);
 assert.ok(minimum>band.level,'enemy layer must exceed hero level: '+band.name+' '+minimum);
 console.log('CHALLENGE '+JSON.stringify({name:band.name,playerLevel:band.level,
  firstEnemyLevel:minimum,lastEnemyLevel:targetClearLevel(band.to),fights:(band.to-band.from+1)*5}));
}
// Keep the shipped CSV in sync with the vetted, 4-round 60% configuration.
const legacyValues={"buff_flame":0.2,"buff_bolt":0.25,"buff_aqua":0.25,"buff_storm":-0.2,"buff_gravity":20,"buff_law":0.25,"buff_chaos":0.15};
assert.equal(Number(data.balance.find(row=>row.key==='resistance_buff_duration').value),4);
assert.ok(Math.abs(Number(data.balance.find(row=>row.key==='defense_resistance_gain').value)-0.18)<1e-9);
for(const row of data.buffs.filter(x=>x.id.startsWith('buff_'))){
 assert.equal(Number(row.duration),4,'four-round '+row.id);
 assert.ok(Math.abs(Number(row.value)-legacyValues[row.id]*.6)<1e-9,'tuned buff '+row.id);
}
const results=[],samples=128;
for(const [duration,scale] of [[2,1],[4,.6]]){
 configure({...data,balance:data.balance.map(row=>row.key==='resistance_buff_duration'?{...row,value:String(duration)}:row.key==='defense_duration_power_step'?{...row,value:duration===2?'0':'250'}:row.key==='defense_resistance_gain'?{...row,value:String(0.3*scale)}:row)});
 const buffs=data.buffs.map(row=>row.id.startsWith('buff_')?{...row,duration:String(duration),value:String(legacyValues[row.id]*scale)}:row);
 for(const band of bands)for(const mode of ['none','flame-once','storm-once']){
  const runs=Array.from({length:samples},(_,i)=>play(17101+i*47,band,mode,buffs));
  const avg=key=>Math.round(runs.reduce((s,x)=>s+x[key],0)/samples*10)/10;
  const wins=runs.filter(x=>x.win);
  const row={name:band.name,mode,duration,scale,samples,winRate:Math.round(1000*wins.length/samples)/10,
   avgCleared:avg('cleared'),avgTurns:avg('turns'),avgIncoming:avg('incoming'),
   avgOutgoing:avg('outgoing'),avgHeroGuards:avg('guards'),avgEnemyGuards:avg('foeGuards'),
   avgHpOnWin:wins.length?Math.round(wins.reduce((s,x)=>s+x.hp/x.maxHp,0)/wins.length*100):null,
   avgMpOnWin:wins.length?Math.round(wins.reduce((s,x)=>s+x.mp/x.maxMp,0)/wins.length*100):null};
  results.push(row);console.log('DEFENSE_BALANCE '+JSON.stringify(row));
 }
}
for(const band of bands)for(const mode of ['none','flame-once','storm-once']){
 const prev=results.find(x=>x.duration===2&&x.name===band.name&&x.mode===mode);
 const now=results.find(x=>x.duration===4&&x.scale===.6&&x.name===band.name&&x.mode===mode);
 console.log('DEFENSE_DELTA '+JSON.stringify({name:band.name,mode,
  winPoints:Math.round((now.winRate-prev.winRate)*10)/10,
  cleared:Math.round((now.avgCleared-prev.avgCleared)*10)/10,
  incomingPercent:prev.avgIncoming?Math.round((now.avgIncoming/prev.avgIncoming-1)*100):null,
  turnsPercent:prev.avgTurns?Math.round((now.avgTurns/prev.avgTurns-1)*100):null}));
}
assert.equal(results.length,bands.length*3*2);
assert.ok(results.every(x=>Number.isFinite(x.avgCleared)&&x.winRate>=0&&x.winRate<=100));
for(const band of bands){
 const old=results.find(x=>x.duration===2&&x.name===band.name&&x.mode==='none');
 const now=results.find(x=>x.duration===4&&x.scale===.6&&x.name===band.name&&x.mode==='none');
 assert.ok(now.winRate+5>=old.winRate,'above-level no-defense win rate regressed: '+band.name+' '+old.winRate+' vs '+now.winRate);
}
for(const name of bands.map(x=>x.name))for(const mode of ['none','flame-once','storm-once']){
 const group=results.filter(x=>x.name===name&&x.mode===mode);
 console.log('STRENGTH_SWEEP '+JSON.stringify({name,mode,variants:group.map(x=>({duration:x.duration,scale:x.scale,winRate:x.winRate,avgCleared:x.avgCleared,avgTurns:x.avgTurns,avgIncoming:x.avgIncoming}))}));
}
console.log('PASS shipped power-scaled shared statuses vs legacy two-round guard in above-level bands');
