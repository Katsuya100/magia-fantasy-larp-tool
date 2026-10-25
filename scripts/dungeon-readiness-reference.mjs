// Frozen, unapproved 50-fight reference: PRE-BANK the final boss's existing recommended level.
// An uninterrupted 50-fight sortie does not gain banked levels; first-time journeys are separate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {unlockedStartLayers} from '../assets/js/dungeon-ranks.mjs';
import {strengthenedPower,totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
export const reference=JSON.parse(readFileSync(new URL('../config/dungeon-recommended-reference-candidate.v1.json',import.meta.url),'utf8'));
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
export function specFor(from){
 const spec=reference.bands.find(x=>x.from===from);
 assert.ok(spec,'missing frozen reference band '+from);
 return spec;
}
export function checkReference(){
 assert.equal(reference.bands.length,10);
 assert.equal(reference.spells.length,5);
 assert.deepEqual(reference.spells.map(x=>x.role),['attack','attack','attack','support','defense']);
 for(const s of reference.bands){
  assert.equal(s.to,s.from+9);
  assert.equal(s.priorCheckpointLevel,s.from===1?1:targetClearLevel(s.from-1));
  assert.equal(s.endingCheckpointLevel,targetClearLevel(s.to));
  assert.equal(s.startLevel,s.endingCheckpointLevel,
   'a no-return fifty-fight benchmark must be ready for its final boss on entry');
  for(let floor=s.from;floor<=s.to;floor++)
   assert.ok(s.startLevel>=targetClearLevel(floor),
    'start level must cover the recommended level of every floor without phantom leveling');
  assert.equal(s.requiredPriorRank,s.from-1);
  assert.equal(s.upgrades.length,5);
  for(const [i,n] of s.upgrades.entries())assert.ok(Number.isInteger(n)&&n>=0&&
   Number.isFinite(strengthenedPower(reference.spells[i].basePower,n)));
  const cap=G.capacity(s.startLevel);
  const kinds=Object.entries(s.requiredItems);
  assert.ok(kinds.every(([id,count])=>(id.startsWith('clear_')||id==='luna_stone')&&
   Number.isInteger(count)&&count>0));
  assert.ok(kinds.reduce((n,[,count])=>n+count,0)<=cap,
   'candidate carry cannot exceed legal capacity');
 }
}
checkReference();
export function stoneCost(s){
 return s.upgrades.reduce((sum,n)=>sum+totalUpgradeStoneCost(n),0);
}
export function expectedPowers(s){
 return reference.spells.map((spell,i)=>strengthenedPower(spell.basePower,s.upgrades[i]));
}
export function assess(snapshot,s){
 const reasons=[];
 if(!snapshot)return {ready:false,reasons:['NO_BANKED_LEGAL_SNAPSHOT']};
 if(snapshot.level<s.startLevel)reasons.push('LEVEL');
 if(!unlockedStartLayers({adventurerRank:snapshot.rank}).includes(s.from))reasons.push('RANK_OR_START');
 if(snapshot.circles?.length!==5)reasons.push('FIVE_CIRCLES');
 else {
  const powers=expectedPowers(s);
  for(let i=0;i<5;i++){
   const c=snapshot.circles[i],r=reference.spells[i];
   if(c.role!==r.role||c.attribute!==r.attribute||
      !Number.isFinite(c.power)||c.power+1e-8<powers[i]||
      Math.abs(c.power-strengthenedPower(c.basePower,c.upgradeLevel))>1e-6)
    reasons.push('CIRCLE_'+(i+1)+'_POWER');
  }
 }
 const held={};
 for(const item of snapshot.carry||[])held[item.id]=(held[item.id]||0)+1;
 for(const [id,count] of Object.entries(s.requiredItems))
  if((held[id]||0)<count)reasons.push('CARRY_'+id);
 const carry=snapshot.carry||[];
 if(carry.length>G.capacity(snapshot.level))reasons.push('CARRY_CAPACITY');
 if(snapshot.unbankedXp!==0||snapshot.unbankedStone!==0||snapshot.unbankedInk!==0)
  reasons.push('NOT_BANKED');
 return {ready:reasons.length===0,reasons,level:snapshot.level,
  power:snapshot.circles?.map(c=>c.power)??[],carried:held};
}
// Separate conditional combat fixture: NEVER use as an economic owner state.
export function combatFixture(s,playerBase){
 const circles=reference.spells.map((r,i)=>({...r,upgradeLevel:s.upgrades[i],
  power:strengthenedPower(r.basePower,s.upgrades[i])}));
 const hero=G.makeUnit(playerBase,s.startLevel,{},circles,'hero');
 const carry=Object.entries(s.requiredItems).flatMap(([id,count])=>
  Array.from({length:count},(_,i)=>({id,instanceId:'REFERENCE_ONLY_'+id+'_'+i,value:0})));
 return {source:'UNAPPROVED_CONDITIONAL_COMBAT_FIXTURE',rank:s.requiredPriorRank,
  level:s.startLevel,playerBase,playerHp:hero.stats.hp,playerMp:hero.maxMp,
  maxHp:hero.stats.hp,maxMp:hero.maxMp,circles,carry,
  statuses:[],cooldowns:hero.cooldowns.map(()=>0)};
}
