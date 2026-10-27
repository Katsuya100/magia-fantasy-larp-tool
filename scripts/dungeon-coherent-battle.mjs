// Canonical economic owner snapshot -> 50-consecutive-encounter combat evaluator.
// No reset between floors, no spawned recovery items, no altered game AI.
// Both diagnostics and 256 independent-account validation call THIS function.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {rng,chooseHero,consumeOwnedRecovery} from './simulate-dungeon-journeys.mjs';
const csv=p=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+p+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),
 enemies:csv('enemies'),buffs:csv('buffs'),collections:csv('collections')};
configure(data);
// Apply the journey's actual legal tactics, including owned spell cooldowns
// and ordinary attack finishers, rather than another divergent chooser.
function cleanse(hero,carry,layer,uses){
 if(layer<6)return;
 const effect=hero.statuses.find(x=>x.kind==='debuff');
 if(!effect)return;
 let i=carry.findIndex(item=>item&&item.id==='clear_'+effect.attribute&&
  G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(i<0)i=carry.findIndex(item=>item&&item.id==='luna_stone'&&
  G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(i<0)return;
 const item=carry[i];
 G.potion(hero,item,data.items,data.buffs);
 uses[item.id]=(uses[item.id]||0)+1;
 carry[i]=null;
}
export function challenge(snapshot,from,seed,{route='short',paired=false,floorCount=10}={}){
  assert.ok(Number.isInteger(floorCount)&&floorCount>=1&&floorCount<=10,'valid authored contiguous floor count');
 const random=rng(seed);
 // Paired deck comparisons must face exactly the same actual encounter IDs.
 // Ordinary owner diagnostics retain the original uninterrupted RNG stream.
 const encounterRandom=paired?rng((seed^0x9e3779b9)>>>0):random;
 const encounterForFight=createSortieEncounterSelector(data.enemies,encounterRandom);
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
  // Initial owner-entry snapshots can legitimately include rank-only mana.
  // This *strict* 50-fight evaluator NEVER uses that mana; only the real
  // journey's unearned 20F+ grade boss is permitted to consume it.
  return Boolean(record);
 }),'a carry item must be owned and floor-legal');
 const result={won:false,cleared:from-1,casts:0,heals:0,spellMpSpent:0,
  opponents:[],fightRounds:[],
  enemyHeals:0,used,bossPreRecovery:null,bossRankEligible:null,firstLoss:null,
  remainingCarry:null,endHp:null,endMp:null,
  startLevel:snapshot.level,endLevel:snapshot.level,fightsAttempted:0,
  startHp:100*hero.hp/hero.stats.hp,startMp:100*hero.mp/hero.maxMp};
 for(let layer=from;layer<from+floorCount;layer++){
  for(let slot=1;slot<=5;slot++){
   assert.equal(hero.level,snapshot.level,'no intra-sortie character leveling');
   result.fightsAttempted++;
   const fight=(layer-1)*5+slot,foe=encounterForFight(fight);
   const enemy=G.fromEnemy(foe,Number(data.floors[fight-1].enemy_level));
   // Every encounter in either arm starts from the same per-fight stream.
   // Different actions may consume different draws within the fight.
   const combatRandom=paired?rng((seed+Math.imul(fight,1013904223))>>>0):random;
   if(paired)result.opponents.push(foe.id);
   let victorious=false,rounds=0;
   for(let turn=0;turn<80;turn++){
    rounds++;
    cleanse(hero,carry,layer,used);
    consumeOwnedRecovery(hero,carry,layer,used,fight);
    const h=chooseHero(hero,enemy,layer,layer>=6,route,
     layer>=20&&layer%10===0&&snapshot.rank<layer),
     e=G.chooseEnemySpell(enemy,combatRandom);
    if(h>=0&&hero.spells[h].role==='support')result.heals++;
    if(e>=0&&enemy.spells[e].role==='support')result.enemyHeals++;
    if(layer<=5&&h>=0&&hero.spells[h].role==='support')
      throw Error('Illegal F1-5 journey combat healing');
    if(h>=0)result.spellMpSpent+=G.spellMpCost(hero.spells[h]);
    G.round(hero,enemy,h,e,data.buffs,combatRandom);
    result.casts++;
    if(hero.hp<=0)break;
    if(enemy.hp<=0){victorious=true;break;}
   }
   if(paired)result.fightRounds.push(rounds);
   if(!victorious){
    result.firstLoss=layer;
    result.firstLossDetail={enemy:enemy.id,enemyLevel:enemy.level,
     enemyHp:enemy.hp,enemyMaxHp:enemy.stats.hp,
     heroHp:hero.hp,heroMaxHp:hero.stats.hp,
     heroMp:hero.mp,heroMaxMp:hero.maxMp,rounds};
    result.endHp=100*hero.hp/hero.stats.hp;
    result.endMp=100*hero.mp/hero.maxMp;
    result.remainingCarry=carry.filter(Boolean).length;
    result.endLevel=hero.level;
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
 result.endLevel=hero.level;
 return result;
}
