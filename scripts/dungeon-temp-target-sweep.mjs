// Canonical economic owner snapshot -> 50-consecutive-encounter combat evaluator.
// No reset between floors, no spawned recovery items, no altered game AI.
// Both diagnostics and 256 independent-account validation call THIS function.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {rng,chooseHero} from './simulate-dungeon-journeys.mjs';
const csv=p=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+p+'.csv',import.meta.url),'utf8'));
let data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),
 enemies:csv('enemies'),buffs:csv('buffs'),collections:csv('collections')};
configure(data);
// Apply the journey's actual legal tactics, including owned spell cooldowns
// and ordinary attack finishers, rather than another divergent chooser.
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
export function challenge(snapshot,from,seed,{route='short'}={}){
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
  // Initial owner-entry snapshots can legitimately include rank-only mana.
  // This *strict* 50-fight evaluator NEVER uses that mana; only the real
  // journey's unearned 20F+ grade boss is permitted to consume it.
  return record&&(record.kind==='clear'||record.kind==='clear_all'||
   (record.kind==='mana'&&from+9>=20));
 }),'a carry item must be owned and floor-legal');
 const result={won:false,cleared:from-1,casts:0,heals:0,
  enemyHeals:0,used,bossPreRecovery:null,bossRankEligible:null,firstLoss:null,
  remainingCarry:null,endHp:null,endMp:null,
  startLevel:snapshot.level,endLevel:snapshot.level,fightsAttempted:0,
  startHp:100*hero.hp/hero.stats.hp,startMp:100*hero.mp/hero.maxMp};
 for(let layer=from;layer<from+10;layer++){
  for(let slot=1;slot<=5;slot++){
   assert.equal(hero.level,snapshot.level,'no intra-sortie character leveling');
   result.fightsAttempted++;
   const fight=(layer-1)*5+slot,foe=encounterForFight(fight);
   const enemy=G.fromEnemy(foe,Number(data.floors[fight-1].enemy_level));
   let victorious=false,rounds=0;
   for(let turn=0;turn<80;turn++){
    rounds++;
    cleanse(hero,carry,layer,used);
    const h=chooseHero(hero,enemy,layer,layer>10,route,
     layer>=20&&layer%10===0&&snapshot.rank<layer),
     e=G.chooseEnemySpell(enemy,random);
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

import {combatFixture,specFor} from './dungeon-readiness-reference.mjs';
const pristine=data;
const originalHeroBases=Array.from({length:256},(_,i)=>G.startingBase(rng(17011+13*i)));
function med(values){if(!values.length)return null;values.sort((a,b)=>a-b);return (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;}
const matrix={"31":[[1,1],[0.965,1],[0.95,1],[0.93,1],[1,0.95],[1,0.9],[1,0.85],[0.97,0.96],[0.96,0.94]],"51":[[1,1],[0.9,1],[0.87,1],[0.84,1],[1,0.95],[1,0.9],[1,0.85],[0.92,0.9],[0.9,0.9],[0.85,0.9]]};
for(const [key,pairs] of Object.entries(matrix)){
 const from=Number(key);
 const result=[];
 for(const [hp,mag] of pairs){
  data={...pristine,enemies:pristine.enemies.map((x,index)=>{
   const layer=Math.floor(index/5)+1;
   if(layer<from||layer>=from+10)return x;
   return {...x,hp:String(Math.max(20,Math.round(Number(x.hp)*hp))),
    mag:String(Math.max(1,Math.round(Number(x.mag)*mag)))};
  })};
  configure(data);
  let wins=0,winmp=[];
  for(let i=0;i<256;i++){
   const got=challenge(combatFixture(specFor(from),originalHeroBases[i]),from,37011+13*i);
   if(got.won){wins++;winmp.push(got.endMp);}
  }
  result.push({hp,mag,wins,mp:med(winmp)});
 }
 console.log('TARGET_SWEEP '+JSON.stringify({from,result}));
}
