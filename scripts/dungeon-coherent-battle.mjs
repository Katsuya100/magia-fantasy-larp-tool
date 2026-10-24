// Canonical economic owner snapshot -> 50-consecutive-encounter combat evaluator.
// No reset between floors, no spawned recovery items, no altered game AI.
// Both diagnostics and 256 independent-account validation call THIS function.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {rng} from './simulate-dungeon-journeys.mjs';
const csv=p=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+p+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),
 enemies:csv('enemies'),buffs:csv('buffs'),collections:csv('collections')};
configure(data);
function choose(hero,enemy,layer){
 const ready=G.available(hero);
 const heal=layer>=11?ready.find(i=>hero.spells[i].role==='support'):undefined;
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const attack=ready.filter(i=>hero.spells[i].role==='attack');
 if(attack.length)return attack.sort((a,b)=>{
  const weight=i=>G.effectivePower(hero,hero.spells[i])*G.resist(enemy,hero.spells[i].attribute);
  return weight(b)-weight(a)||a-b;
 })[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
function cleanse(hero,carry,layer,uses){
 if(layer<51)return;
 const effect=hero.statuses.find(x=>x.kind==='debuff');
 if(!effect)return;
 let i=carry.findIndex(item=>item&&item.id==='clear_'+effect.attribute&&
  G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(i<0&&layer>=71)i=carry.findIndex(item=>item&&item.id==='luna_stone'&&
  G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(i<0)return;
 const item=carry[i];
 G.potion(hero,item,data.items,data.buffs);
 uses[item.id]=(uses[item.id]||0)+1;
 carry[i]=null;
}
export function challenge(snapshot,from,seed){
 const random=rng(seed),encounterForFight=createSortieEncounterSelector(data.enemies,random);
 const hero=G.makeUnit(snapshot.playerBase,snapshot.level,{},
  snapshot.circles.map(x=>({role:x.role,attribute:x.attribute,power:x.power,
   basePower:x.basePower,upgradeLevel:x.upgradeLevel})),'hero');
 // The first entry may be partway through a long dive. The observed health
 // and inventory are NOT reset at each new ten-layer band.
 assert.ok(snapshot.playerHp>0&&snapshot.playerHp<=hero.stats.hp);
 assert.ok(snapshot.playerMp>=0&&snapshot.playerMp<=hero.maxMp);
 hero.hp=snapshot.playerHp;hero.mp=snapshot.playerMp;
 hero.statuses=(snapshot.statuses||[]).map(x=>({...x}));
 hero.cooldowns=[...(snapshot.cooldowns||hero.cooldowns)];
 const carry=snapshot.carry.map(x=>({...x})),used={};
 assert.ok(carry.length<=G.capacity(snapshot.level),'all items must fit real slots');
 assert.ok(carry.every(item=>{
  const record=data.items.find(x=>x.id===item.id);
  // Existing owned items may be carried from a lower unlocked start.
  // The drop min_layer is not a combat-use or pack restriction.
  return record&&(record.kind==='clear'||record.kind==='clear_all');
 }),'a carry item must be owned and floor-legal');
 const result={won:false,cleared:from-1,casts:0,heals:0,
  enemyHeals:0,used,bossPreRecovery:null,bossRankEligible:null,firstLoss:null,
  remainingCarry:null,endHp:null,endMp:null,
  startHp:100*hero.hp/hero.stats.hp,startMp:100*hero.mp/hero.maxMp};
 for(let layer=from;layer<from+10;layer++){
  for(let slot=1;slot<=5;slot++){
   const fight=(layer-1)*5+slot,foe=encounterForFight(fight);
   const enemy=G.fromEnemy(foe,Number(data.floors[fight-1].enemy_level));
   let victorious=false;
   for(let turn=0;turn<80;turn++){
    cleanse(hero,carry,layer,used);
    const h=choose(hero,enemy,layer),e=G.chooseEnemySpell(enemy,random);
    if(h>=0&&hero.spells[h].role==='support')result.heals++;
    if(e>=0&&enemy.spells[e].role==='support')result.enemyHeals++;
    if(layer<=10&&(h>=0&&hero.spells[h].role==='support'||
     e>=0&&enemy.spells[e].role==='support'))
      throw Error('Illegal 1-10F combat healing');
    G.round(hero,enemy,h,e,data.buffs,random);
    result.casts++;
    if(hero.hp<=0)break;
    if(enemy.hp<=0){victorious=true;break;}
   }
   if(!victorious){
    result.firstLoss=layer;result.endHp=100*hero.hp/hero.stats.hp;
    result.endMp=100*hero.mp/hero.maxMp;
    result.remainingCarry=carry.filter(Boolean).length;
    return result;
   }
   // Rank eligibility is a separate outcome, sampled before ALL healing,
   // even the ordinary victory MP restoration on the boss.
   if(slot===5&&layer%10===0){
    result.bossPreRecovery={hp:100*hero.hp/hero.stats.hp,
     mp:100*hero.mp/hero.maxMp};
    result.bossRankEligible=Boolean(rankBadgeDrop(fight,hero,
     {adventurerRank:Math.min(snapshot.rank,layer-10)}));
   }
   hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
   G.recoverVictoryMp(hero,layer);
  }
  result.cleared=layer;
 }
 result.won=true;result.endHp=100*hero.hp/hero.stats.hp;
 result.endMp=100*hero.mp/hero.maxMp;
 result.remainingCarry=carry.filter(Boolean).length;
 return result;
}
