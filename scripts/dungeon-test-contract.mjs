// Canonical test-only contracts: fail on invalid measurements, never repair them.
import assert from 'node:assert/strict';
export const FIXED_CARRY={1:[0,0],11:[0,0],21:[0,0],31:[0,0],41:[0,0],51:[13,0],61:[14,0],71:[13,2],81:[14,2],91:[16,2]};
export function assertFixedInventory(from,items){
 const expected=FIXED_CARRY[from];assert.ok(expected,'unknown fixed band');
 assert.equal(items.length,expected[0]+expected[1],'fixed carry count');
 assert.equal(items.filter(id=>id==='luna_stone').length,expected[1],'Luna count');
 assert.equal(items.filter(id=>/^clear_(flame|bolt|aqua|storm|gravity|law|chaos)$/.test(id)).length,expected[0],'specialist cleansers');
 assert.ok(items.every(id=>id==='luna_stone'||/^clear_(flame|bolt|aqua|storm|gravity|law|chaos)$/.test(id)),'no forbidden fixed consumables');
}
export function assertFixedTrace(run,from,to){
 assert.equal(to,from+9,'50-fight band only');
 assertFixedInventory(from,run.initialLoadout);
 assert.ok(run.layerStats.length>0&&run.layerStats.length<=10);
 assert.equal(run.layerStats[0].layer,from);
 assert.equal(run.layerStats[0].startHp,run.maxHp);
 assert.equal(run.layerStats[0].startMp,run.maxMp);
 assert.equal(run.restores??0,0,'no mid-sortie full recovery');
 const fights=run.fightStats;
 assert.ok(Array.isArray(fights)&&fights.length>0&&fights.length<=50,
  'fixed deck must provide individual combat traces, not only floor summaries');
 assert.equal(fights[0].fight,(from-1)*5+1,'fixed deck starts at the actual first encounter');
 assert.equal(fights[0].hpBefore,run.maxHp,'first fight starts with full HP');
 assert.equal(fights[0].mpBefore,run.maxMp,'first fight starts with full MP');
 for(let i=1;i<fights.length;i++){
  const previous=fights[i-1],current=fights[i];
  assert.equal(previous.win,true,'cannot skip a lost fight');
  assert.equal(current.fight,previous.fight+1,'exactly consecutive battles');
  assert.equal(current.hpBefore,previous.hpAfter,
   'unexpected HP refill between fights, including inside a floor');
  assert.equal(current.mpBefore,previous.mpAfterVictoryRecovery,
   'unexpected MP refill between fights, including inside a floor');
  if(from>=51){
   assert.equal(current.itemsBefore,previous.itemsAfter,'no between-fight inventory restock');
  }
 }
 if(from>=51){
  assert.equal(fights[0].itemsBefore,run.initialLoadout.length);
  for(const fight of fights){
   assert.ok(Number.isInteger(fight.itemsBefore)&&Number.isInteger(fight.itemsAfter));
   assert.ok(fight.itemsAfter<=fight.itemsBefore,'no new items during fixed combat');
  }
 }
 for(let i=1;i<run.layerStats.length;i++){
  const a=run.layerStats[i-1],b=run.layerStats[i];
  assert.equal(a.cleared,true,'previous floor must be cleared');
  assert.equal(b.layer,a.layer+1);
  assert.equal(b.startHp,a.endHp,'no inter-floor HP recovery');
  assert.equal(b.startMp,a.endMp,'no inter-floor MP recovery');
  if(from>=51)assert.equal(b.itemsAtStart,a.itemsAtEnd,'no free item restock');
 }
 if(run.win){
  assert.equal(run.layerStats.length,10);
  assert.equal(run.cleared,to*5);
  assert.equal(fights.length,50,'a claimed fifty-win sortie needs fifty fought encounters');
  assert.equal(fights.at(-1).mpAfterVictoryRecovery,run.layerStats.at(-1).endMp,
   'winner MP must be sampled after ordinary victory recovery, before optional full heal');
  assert.ok(Math.abs(run.mp*run.maxMp/100-run.layerStats.at(-1).endMp)<1e-6,
   'winner sampled MP cannot include post-boss elective full recovery');
  assert.ok(Math.abs(run.hp*run.maxHp/100-run.layerStats.at(-1).endHp)<1e-6,
   'winner sampled HP cannot include post-boss elective full recovery');
 }
}
export const journeySpellAllowed=(layer,unlocked,role)=>
 role==='attack'||role==='basic'||Boolean(unlocked)&&(layer>=6||layer>=3&&role!=='support');
export const journeyItemAllowed=(layer,kind)=>layer>=6||kind==='mana';
export function assertPairedCharacters(a,b){
 for(const k of ['level','rank','playerHp','playerMp','maxHp','maxMp','playerBase','carry','statuses','cooldowns'])
  assert.deepEqual(a[k],b[k],'unequal paired character condition: '+k);
 assert.equal(a.circles.length,5);assert.equal(b.circles.length,5);
}
export function assert256Seeds(seeds){
 assert.equal(seeds.length,256,'no reduced seed denominator');
 assert.equal(new Set(seeds).size,256,'no duplicate or dropped seeds');
}

export function assertEntireFloorCoverage(floors,expected=100){
 assert.equal(floors.length,expected,'must inspect every individual floor');
 for(let i=0;i<expected;i++){
  const floor=floors[i];assert.equal(floor.layer,i+1,'no decade-only shortcut');
  const r=floor.readiness;
  assert.ok(r&&r.prepared>=0&&r.prepared<=256,'readiness counts must exist');
  assert.equal(r.missingSeeds.length,256-r.prepared,'unready seeds cannot disappear');
  assert.equal(r.firstEntryReady+r.additionalFarmingReady,r.prepared,
   'first-entry and extra-farming successes cannot be double counted');
 }
}
export function assertBankedJourneySnapshot(s){
 assert.ok(s&&s.source==='POST_RETURN_BANKED_AND_INVESTED','no synthetic readiness');
 assert.equal(s.unbankedXp,0,'unbanked XP cannot prepare journey');
 assert.equal(s.unbankedStone,0,'unbanked stones cannot prepare journey');
 assert.equal(s.unbankedInk,0,'unbanked ink cannot prepare journey');
 assert.equal(s.earned.stone,s.spent.stone+s.bankedStones,'no free magic stones');
 assert.equal(s.earned.ink,s.spent.ink+s.bankedInk,'no free magic ink');
 assert.ok(s.rank<=s.bankedBestLayer,'no unearned adventurer rank');
 assert.ok(s.carry.length<=s.maxCarry,'real item capacity is mandatory');
}
export function assertPreRecoveryRankGate(record){
 if(record.failure==='PRIOR_RANK_OR_DUPLICATE')return;
 assert.equal(record.eligible,
  record.hpPercent>=80&&record.mpPercent>=80,
  'rank must be evaluated at lethal boss HP/MP before victory recovery');
}
export function assertNotFalsePass({passed,missing=0,cutoff=false}){
 assert.ok(!passed||missing===0&&!cutoff,'unready seeds and cutoffs cannot PASS');
}

export function certifiesPreEntryReadiness(row){
 const p=row?.floorPreparation;
 return Boolean(p&&p.layer===row.layer&&p.ready&&p.completeCombatKit&&
  p.circleIntegrity&&p.itemIntegrity&&p.rankLegal&&
  p.attackCoverage===5&&Number.isFinite(p.powerPerMp)&&p.powerPerMp>0&&
  Number.isInteger(p.acquiredUpgrades)&&p.acquiredUpgrades>=0&&
  p.sustainableAttackActions>0&&p.level>=(p.layer===1?1:p.recommendedLevel)&&
  row.attemptedFights===5&&row.cleared);
}

export function chooseAdditionalFarmingBand(eligible,counts,proven,hasCombatProof){
 const first=eligible.find(b=>(counts[b]||0)<3);
 if(first!==undefined)return first;
 if(!hasCombatProof)return null;
 return eligible.filter(b=>!proven[b])
  .sort((a,b)=>(counts[a]||0)-(counts[b]||0)||a-b)[0]??null;
}
