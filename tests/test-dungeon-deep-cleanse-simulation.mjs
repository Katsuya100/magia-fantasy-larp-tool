// Floors 51-100 only: paired real-combat trials with equipped debuff cleansers.
// Uses the shipped combat/item functions, legal carry capacity, and the
// official repeat-sortie stone economy (75% spent before each 10-layer band).
// Inventory availability is an explicit stocked-loadout assumption, not a
// claim that the expected drops can supply every cleanser or Luna Stone.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {alignEnemySpellFlavor} from '../scripts/dungeon-enemy-spell-flavor.mjs';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {enemyForFight} from '../assets/js/dungeon-design.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {simulateProgression} from '../scripts/simulate-dungeon-stones.mjs';
import {withNeutralAttackAttributes,compareNeutralAttackChoices} from './helpers/dungeon-neutral-loadout.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),buffs:csv('buffs'),balance:csv('balance'),
 levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
// The first 19 layers keep exactly the same 76 ordinary foes, while their
// 19 bosses now have deliberate elemental identities. Check the unaffected
// enemies against the exact catalog before the flavor change.
const early=data.enemies.slice(0,95).filter(row=>row.boss_only==='0');
// The historical fixture predates the approved flavor rewrite. Compare to
// reproducible current spell-generation rules, not obsolete spell strings.
const reference=alignEnemySpellFlavor(alignNormalRows(G.parseCsv(readFileSync(
 new URL('./fixtures/dungeon-enemies-pre-readable-affinities.csv',import.meta.url),'utf8'))))
 .slice(0,95).filter(row=>row.boss_only==='0');
for(let i=0;i<early.length;i++){
 for(const key of Object.keys(reference[i])){
  if(!key.startsWith('resist_')&&!['hp','mag','def','res'].includes(key))
   assert.equal(early[i][key],reference[i][key],'early identity and all five spells unchanged '+early[i].id+' '+key);
 }
}
let previousMinimum=0;
for(let layer=51;layer<=100;layer++){
 const five=data.enemies.slice((layer-1)*5,layer*5);
 assert.equal(five.length,5);
 const powers=five.map(enemy=>{
  const debuffs=enemy.spells.split('|').filter(spell=>spell.startsWith('debuff:'));
  assert.ok(debuffs.length<=1,'at most one debuff slot per enemy');
  return debuffs.length?Number(debuffs[0].split(':')[2]):null;
 });
 const castPowers=powers.filter(Number.isFinite);
 assert.equal(castPowers.length,2,'exactly two specialists per layer '+layer);
 const lower=Math.min(...castPowers),upper=Math.max(...castPowers);
 assert.equal(lower,Math.round(250+(layer-51)*500/49),'minimum debuff power floor '+layer);
 assert.equal(upper-lower,30,'preserve a 30-point per-layer spread');
 assert.ok(lower>=previousMinimum,'minimum strength must grow monotonically');
 assert.ok(castPowers.every(power=>G.statusDuration({power})===Math.min(6,2+Math.floor(power/250))));
 previousMinimum=lower;
}
assert.equal(previousMinimum,750);
assert.equal(Math.max(...data.enemies.slice(495,500).flatMap(enemy=>{
 const curse=enemy.spells.split('|').find(spell=>spell.startsWith('debuff:'));
 return curse?[Number(curse.split(':')[2])]:[];
})),780);

const SPELLS=[
 {role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'bolt',power:420},
 {role:'attack',attribute:'gravity',power:540},
 {role:'support',attribute:'aqua',power:320},
 {role:'defense',attribute:'law',power:270}
];
function upgradeSpells(budget,original=SPELLS){
 const spells=original.map(s=>({...s,basePower:s.power}));
 const counts=spells.map(()=>0);
 for(let i=0;i<budget;i++){
  const candidates=spells.map((spell,index)=>({spell,index})).filter(x=>['attack','support'].includes(x.spell.role));
  const score=({spell,index})=>{
   const now=G.basePower(spell.power),next=G.basePower(strengthenedPower(original[index].power,counts[index]+1));
   return (next-now+.15)/(counts[index]+1)**.25;
  };
  candidates.sort((a,b)=>score(b)-score(a)||a.index-b.index);
  const selected=candidates[0].index;
  spells[selected].power=strengthenedPower(original[selected].power,++counts[selected]);
 }
 return spells;
}
function enemyChoice(unit,r){return G.chooseEnemySpell(unit,r);}
function heroChoice(hero,enemy){
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=ids.find(i=>hero.spells[i].role==='support');
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offense=ids.filter(i=>hero.spells[i].role==='attack');
 if(offense.length)return offense.sort((a,b)=>compareNeutralAttackChoices(hero,enemy,a,b))[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
const BANDS=[
 {from:51,to:60,level:102},{from:61,to:70,level:115},{from:71,to:80,level:128},
 {from:81,to:90,level:139},{from:91,to:100,level:150}
];
// Prepare a legal, counter-focused selection. At 71+ two slots are reserved
// for Luna Stones, available since floor 70; prior bands use specific cleansers.
// Multiple consumables with one ID still represent distinct inventory instances.
function cleanseLoadout(band){
 const capacity=G.capacity(band.level),frequency=new Map();
 for(let layer=band.from;layer<=band.to;layer++)for(const enemy of data.enemies.slice((layer-1)*5,layer*5)){
  const spell=enemy.spells.split('|').find(x=>x.startsWith('debuff:'));
  if(!spell)continue;
  const attr=spell.split(':')[1];
  frequency.set(attr,(frequency.get(attr)||0)+1);
 }
 const lunaCount=band.from>=71?2:0;
 const kit=Array.from({length:lunaCount},()=>({id:'luna_stone',value:0,bonus:null}));
 const allocations=new Map();
 const attrs=[...frequency].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(x=>x[0]);
 for(const attr of attrs){
  if(kit.length>=capacity)break;
  allocations.set(attr,1);kit.push({id:'clear_'+attr,value:0,bonus:null});
 }
 while(kit.length<capacity){
  const attr=[...attrs].sort((a,b)=>frequency.get(b)/(allocations.get(b)+1)-frequency.get(a)/(allocations.get(a)+1)||a.localeCompare(b))[0];
  allocations.set(attr,allocations.get(attr)+1);
  kit.push({id:'clear_'+attr,value:0,bonus:null});
 }
 assert.equal(kit.length,capacity);
 assert.ok(kit.every(item=>{const row=data.items.find(x=>x.id===item.id);return row&&Number(row.min_layer)<=band.from-1&&['clear','clear_all'].includes(row.kind);}));
 return kit;
}
function useCleanser(hero,carry){
 const effects=hero.statuses.filter(status=>status.kind==='debuff');
 if(!effects.length)return null;
 // A single consumable is used between combat rounds; no magic/HP potion.
 // Preserve broad-spectrum Luna Stones for effects with no specific cleanser.
 const specific=carry.findIndex(item=>item&&item.id==='clear_'+effects[0].attribute
  &&G.canUseBattleItem(hero,item,data.items,data.buffs));
 const index=specific>=0?specific:carry.findIndex(item=>item&&item.id==='luna_stone'
  &&G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(index<0)return null;
 const item=carry[index];
 G.potion(hero,item,data.items,data.buffs);
 carry[index]=null;
 return item.id;
}
const cache=new Map();
function earnedStones(seed,layer){
 if(!cache.has(seed))cache.set(seed,simulateProgression(seed));
 const milestone=cache.get(seed).milestones.find(x=>x.layer===layer);
 assert.ok(milestone,'valid previous checkpoint '+layer);
 return milestone.stones;
}
export function deepRun(seed,band,equipped,enemyMaster=data.enemies){
 assert.ok(band.from>=51&&band.to<=100&&band.to-band.from===9);
 const random=rng(seed),stones=earnedStones(seed+81,band.from-1),spent=Math.floor(stones*.75);
 const chosen=withNeutralAttackAttributes(SPELLS,data.enemies,band.from,band.to);
 const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},band.level,{},upgradeSpells(spent,chosen.spells),'hero');
 const carry=equipped?cleanseLoadout(band):[];
 const initialLoadout=carry.map(item=>item.id);
 const layerStats=[];
 let cleared=(band.from-1)*5,rounds=0,debuffCasts=0,cleanseUsed=0,cleanseByType={};
 const first=cleared+1,last=band.to*5;
 for(let fight=first;fight<=last;fight++){
  if(fight%5===1)layerStats.push({layer:Math.ceil(fight/5),
   startHp:hero.hp,startMp:hero.mp,itemsAtStart:carry.filter(Boolean).length,
   lunaAtStart:carry.filter(item=>item?.id==='luna_stone').length,
   usedBefore:cleanseUsed,cleared:false,endHp:null,endMp:null,
   itemsAtEnd:null,usedAfter:null});
  const enemy=G.fromEnemy(enemyForFight(enemyMaster,fight),+data.floors[fight-1].enemy_level);
  let won=false;
  for(let turn=0;turn<80;turn++){
   if(equipped){
    const id=useCleanser(hero,carry);
    if(id){cleanseUsed++;cleanseByType[id]=(cleanseByType[id]||0)+1;}
   }
   const heroPick=heroChoice(hero,enemy),enemyPick=enemyChoice(enemy,random);
   if(enemyPick>=0&&enemy.spells[enemyPick].role==='debuff')debuffCasts++;
   G.round(hero,enemy,heroPick,enemyPick,data.buffs,random);
   rounds++;
   if(hero.hp<=0)break;
   if(enemy.hp<=0){won=true;break;}
  }
  if(!won){
   const entry=layerStats.at(-1);
   entry.endHp=hero.hp;entry.endMp=hero.mp;
   entry.itemsAtEnd=carry.filter(Boolean).length;entry.usedAfter=cleanseUsed;
   break;
  }
  cleared=fight;
  hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
  G.recoverVictoryMp(hero,Math.ceil(fight/5));
  if(fight%5===0){
   const entry=layerStats.at(-1);
   entry.cleared=true;entry.endHp=hero.hp;entry.endMp=hero.mp;
   entry.itemsAtEnd=carry.filter(Boolean).length;entry.usedAfter=cleanseUsed;
  }
 }
 return {win:cleared===last,cleared,hp:hero.hp,mp:hero.mp,maxHp:hero.stats.hp,maxMp:hero.maxMp,
  stones,spent,rounds,debuffCasts,cleanseUsed,cleanseByType,attackAttributes:chosen.attackAttributes,
   carryCount:carry.length,
  remaining:carry.filter(Boolean).length,initialLoadout,layerStats};
}
// Keep standalone cleanse trials mandatory, but don't rerun them as an import.
if(process.argv[1]===fileURLToPath(import.meta.url)){
const samples=Number(process.env.DUNGEON_DEBUFF_SAMPLES||64);
assert.ok(Number.isSafeInteger(samples)&&samples>=16&&samples<=1024);
const mean=a=>a.length?a.reduce((sum,x)=>sum+x,0)/a.length:null;
const percent=(a)=>a===null?null:Math.round(a*10)/10;
let totalItems=0;
for(const band of BANDS){
 const pairs=Array.from({length:samples},(_,i)=>{
  const seed=17011+i*13;
  return {without:deepRun(seed,band,false),with:deepRun(seed,band,true)};
 });
 const summarize=mode=>{
  const all=pairs.map(x=>x[mode]),wins=all.filter(x=>x.win);
  return {wins:wins.length,winRate:percent(wins.length/samples*100),
   hpWin:percent(mean(wins.map(x=>x.hp/x.maxHp*100))),
   mpWin:percent(mean(wins.map(x=>x.mp/x.maxMp*100))),
   avgDebuffCasts:percent(mean(all.map(x=>x.debuffCasts))),
   avgCleanses:percent(mean(all.map(x=>x.cleanseUsed))),
   avgRemaining:percent(mean(all.map(x=>x.remaining))),
   lossByLayer:Object.entries(all.filter(x=>!x.win).reduce((a,x)=>{
    const layer=Math.ceil((x.cleared+1)/5);a[layer]=(a[layer]||0)+1;return a;
   },{}))};
 };
 totalItems+=pairs.reduce((sum,p)=>sum+p.with.cleanseUsed,0);
 const row={band:band.from+'-'+band.to,level:band.level,samples,
  earnedStones:percent(mean(pairs.map(x=>x.with.stones))),
  spentStones:percent(mean(pairs.map(x=>x.with.spent))),
  maxCarry:G.capacity(band.level),attackAttributes:pairs[0].with.attackAttributes,
   loadout:cleanseLoadout(band).map(x=>x.id),
  without:summarize('without'),with:summarize('with')};
 assert.ok(row.with.avgCleanses<=row.maxCarry);
 console.log('DEBUFF_DEPTH_SIM '+JSON.stringify(row));
}
assert.ok(totalItems>0,'a stocked cleaner loadout must exercise real potion use');
console.log('PASS only 51-100F debuff strength progression and paired equipped-cleanser combat trials');
}
