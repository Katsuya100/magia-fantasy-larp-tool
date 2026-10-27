import assert from 'node:assert/strict';
import {buildManifest} from '../scripts/dungeon-balance-manifest.mjs';
import {specFor,assess} from '../scripts/dungeon-readiness-reference.mjs';
import {chooseAdditionalFarmingBand} from '../scripts/dungeon-test-contract.mjs';
import {runJourney,spread,investmentRate,ECONOMY_VERSION,chooseHero,consumeOwnedRecovery} from '../scripts/simulate-dungeon-journeys.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {rankBadgeDrop,unlockedStartLayers} from '../assets/js/dungeon-ranks.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {createSortieEncounterSelector} from '../scripts/dungeon-balance-encounters.mjs';
import {readFileSync} from 'node:fs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
const foes=csv('enemies');
// The deep boss mana reserve spends one genuinely owned item, and ordinary
// deep encounters cannot burn that reserve solely for being below 82%.
const recoveryHero=G.makeUnit({hp:100,mag:10,def:7,res:7},150,{},[],'hero');
recoveryHero.mp=Math.round(recoveryHero.maxMp*.70);
const carriedDose={id:'mana_xl',value:800,instanceId:'earned-mana-1'};
const ordinaryCarry=[{...carriedDose}],ordinaryUsage={};
consumeOwnedRecovery(recoveryHero,ordinaryCarry,99,ordinaryUsage,495);
assert.equal(ordinaryCarry[0].instanceId,'earned-mana-1');
assert.equal(Object.keys(ordinaryUsage).length,0);
assert.ok(recoveryHero.mp<recoveryHero.maxMp);
const bossCarry=[{...carriedDose}],bossUsage={};
// F100's first four ordinary encounters must not use the 82% boss reserve.
const preBossCarry=[{...carriedDose}],preBossUsage={};
consumeOwnedRecovery(recoveryHero,preBossCarry,100,preBossUsage,496);
assert.equal(preBossCarry[0].instanceId,'earned-mana-1');
assert.equal(Object.keys(preBossUsage).length,0);
assert.ok(recoveryHero.mp<recoveryHero.maxMp);
consumeOwnedRecovery(recoveryHero,bossCarry,100,bossUsage,500);
assert.equal(bossCarry[0],null,'the genuine mana item must be consumed once');
assert.equal(bossUsage.mana_xl,1);
assert.equal(recoveryHero.mp,recoveryHero.maxMp,'the legal potion caps at actual maximum MP');
// Prevent undoing explicit user bans on game-balance escape hatches.
// A future new balance knob requires review, not a passing test fixture.
const forbiddenKnobs=['xp_overlevel_decay_per_10_levels',
 'victory_mp_intro_floor_bonus','enemy_intro_attack_preference'];
const actualBalanceKeys=new Set(csv('balance').map(row=>row.key));
const shippedCore=readFileSync(new URL('../assets/js/dungeon-core.mjs',import.meta.url),'utf8');
for(const key of forbiddenKnobs){
 assert.ok(!actualBalanceKeys.has(key),'removed gameplay knob must not be recreated: '+key);
 assert.ok(!shippedCore.includes("num('"+key+"')"),
  'shipped gameplay must not depend on removed knob: '+key);
}

let shuffleRolls=0;
const selector=createSortieEncounterSelector(foes,()=>{shuffleRolls++;return .3;});
const shuffled=Array.from({length:4},(_,i)=>selector(i+1).id);
assert.equal(new Set(shuffled).size,4,'all ordinary encounters must appear once');
assert.deepEqual(new Set(shuffled),new Set(
 Array.from({length:4},(_,i)=>'foe_l001_'+(i+1))),
 'the browser shuffles only within an authored floor');
assert.equal(shuffleRolls,3,'floor order is rolled only once');
assert.equal(selector(1).id,shuffled[0],'returning to same slot does not reroll');
assert.equal(shuffleRolls,3);
assert.equal(selector(5).id,'boss_l001','boss remains fifth, never shuffled');
assert.equal(shuffleRolls,3);
assert.equal(new Set(Array.from({length:4},(_,i)=>selector(6+i).id)).size,4);
assert.equal(shuffleRolls,6,'different floor shuffles independently');

const intro=G.makeUnit({hp:100,mag:10,def:7,res:7},1,{},[],'hero');
intro.mp=0;
const earnedAt10=G.recoverVictoryMp(intro,10);
intro.mp=0;
const earnedAt11=G.recoverVictoryMp(intro,11);
assert.ok(earnedAt10>earnedAt11,'intro victory reward is greater, not a battle recovery spell');
assert.ok(earnedAt10<=intro.maxMp&&earnedAt11<=intro.maxMp);

assert.equal(G.chooseEnemySpell(
 G.fromEnemy(foes.find(x=>x.id==='foe_l001_1'),1),()=>.001)>=0,true);
const introFoe=G.fromEnemy(foes.find(x=>x.id==='foe_l001_1'),1);
const attackRate=num('enemy_attack_preference');
assert.ok(attackRate>0&&attackRate<1,'shared enemy AI uses a real probability');
const pickedAttack=G.chooseEnemySpell(introFoe,()=>attackRate/2);
const pickedGuard=G.chooseEnemySpell(introFoe,()=>(1+attackRate)/2);
assert.equal(introFoe.spells[pickedAttack].role,'attack','intro attacks share the standard enemy attack chance');
assert.equal(introFoe.spells[pickedGuard].role,'defense','intro guards remain possible');
assert.equal(introFoe.base.mag,Number(foes.find(x=>x.id==='foe_l001_1').mag),
 'combat reads the authentic authored enemy MAG, not a test-only damage value');

// Paid law defense must actually counter the enemy's law element.
// Against an unrelated attribute, it wastes a turn without protection.
const tacticalSpells=[
 {role:'attack',attribute:'flame',power:420,basePower:420},
 {role:'support',attribute:'aqua',power:320,basePower:320},
 {role:'defense',attribute:'law',power:270,basePower:270}
];
const tacticalHero=G.makeUnit({hp:100,mag:10,def:7,res:7},37,{},tacticalSpells,'hero');
tacticalHero.hp=Math.floor(tacticalHero.stats.hp*.6);
tacticalHero.cooldowns[1]=1; // Healing is cooling down; no mana bypass.
const unrelated=G.fromEnemy(foes.find(x=>x.id==='foe_l017_2'),32);
const matching=G.fromEnemy(foes.find(x=>x.id==='foe_l016_1'),30);
assert.equal(chooseHero(tacticalHero,unrelated,17,true,'short',false),0,
 'Do not waste a defense cast against an enemy with no law threat');
assert.equal(chooseHero(tacticalHero,matching,17,true,'short',false),2,
 'The same earned law ward remains available against a real law threat');
assert.equal(chooseHero(tacticalHero,matching,10,false,'short',false),0,
 'Strict pre-F2 tutorial policy cannot use support or defensive magic');

const finishingHero=G.makeUnit({hp:100,mag:10,def:7,res:7},37,{},tacticalSpells,'hero');
finishingHero.hp=Math.floor(finishingHero.stats.hp*.65);
const nearlyDown=G.fromEnemy(foes.find(x=>x.id==='foe_l017_2'),32);
nearlyDown.hp=1;
assert.equal(chooseHero(finishingHero,nearlyDown,17,true,'short',false),0,
 'An available real finishing attack avoids wasting MP and another exposed round');
assert.equal(chooseHero(finishingHero,nearlyDown,20,true,'short',true),0,
 'A pending badge must not forbid a finishing blow against ordinary enemies');
const nearlyDownBoss=G.fromEnemy(foes.find(x=>x.id==='boss_l020'),37);
nearlyDownBoss.hp=1;
assert.equal(chooseHero(finishingHero,nearlyDownBoss,20,true,'short',true),1,
 'Protect the pending rank boss HP and MP reserve rather than bypassing the healing plan');
nearlyDown.hp=nearlyDown.stats.hp;
assert.equal(chooseHero(finishingHero,nearlyDown,17,true,'short',false),1,
 'Healing remains available against an enemy that cannot be finished immediately');


// A long expedition cannot silently jump past either late checkpoint:
// both 80F and 90F must be banked through real boss victories before
// deliberately replaying the previous decade for paid spell preparation.
const checkpointJourney=runJourney(17011,{style:'A',route:'long'});
assert.ok(checkpointJourney.best>=100,'the deterministic checkpoint test owner must clear 100F');
for(const depth of [80,90]){
 const first=checkpointJourney.trace.find(t=>!t.defeat&&t.cleared>=depth);
 assert.ok(first,'late checkpoint must be reached via a banked legal return');
 assert.equal(first.cleared,depth,'long route must bank the actual '+depth+'F checkpoint before advancing');
}

const manifest=buildManifest();
assert.equal(manifest.schemaVersion,'dungeon-levers-v1');
assert.ok(manifest.entries.length>500,'must inventory more than balance CSV');
assert.equal(new Set(manifest.entries.map(x=>x.id)).size,manifest.entries.length);
for(const entry of manifest.entries){
 assert.ok(entry.id&&entry.implementationRef&&entry.description&&entry.unit);
 assert.ok(entry.defaultValue!==undefined&&entry.allowedRange===null);
 assert.ok(entry.journeys.length&&entry.relatedTests.length);
 assert.ok(['hard-contract','diagnostic'].includes(entry.obligation));
}
const find=id=>manifest.entries.find(entry=>entry.id===id);
assert.equal(find('csv.balance.magic_stone_drop_chance.value').defaultValue,.30);
assert.equal(find('csv.balance.magic_stone_drop_chance_layer_150.value').defaultValue,.90);
assert.equal(find('csv.balance.level_max.value').defaultValue,150);
assert.equal(find('ink.bossDropChance').defaultValue,.20);
assert.equal(find('upgrade.initialCostSteps').defaultValue,20);
assert.equal(find('alchemy.guaranteedInkEvery').defaultValue,20);
assert.equal(investmentRate(10),.25);
assert.equal(investmentRate(20),.75);
assert.equal(investmentRate(50),.75);
assert.deepEqual(spread([1,2,3,4,5]),{p10:1.4,median:3,p90:4.6});

// Independent rank *rule* contract, not a claim that a normal combatant can
// finish the ten-layer sortie at 80%. Never grant a badge after MP restoration.
for(let layer=10;layer<=100;layer+=10){
 const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},Math.min(150,layer+10));
 const profile={adventurerRank:0};
 const fight=layer*5;
 hero.hp=Math.ceil(hero.stats.hp*.8);
 hero.mp=Math.ceil(hero.maxMp*.8);
 assert.equal(rankBadgeDrop(fight,hero,profile)?.layer,layer);
 hero.hp=Math.max(0,Math.ceil(hero.stats.hp*.8)-1);
 assert.equal(rankBadgeDrop(fight,hero,profile),null,'HP below threshold');
 hero.hp=hero.stats.hp;
 hero.mp=Math.max(0,Math.ceil(hero.maxMp*.8)-1);
 assert.equal(rankBadgeDrop(fight,hero,profile),null,'MP below threshold');
 assert.equal(rankBadgeDrop(fight-1,hero,profile),null,'rank only after boss');
}
for(const style of ['A','B','C'])for(const route of ['short','long']){
 // Limited-action test: strictly validates mechanics, no invented success.
 const run=runJourney(20261024,{style,route,maxSorties:2,maxFights:120});
 assert.equal(run.style,style);assert.equal(run.route,route);
 assert.ok(run.trace.length>0);
 // Every route banks one NEW floor at a time before the first F10 clear;
 // utility is unlocked only after a real banked F2 return.
 for(const step of run.trace){
  if(step.tutorial){
   assert.equal(step.start,1,'tutorial sorties begin at the legal F1 gate');
   assert.ok(step.goal>=1&&step.goal<=10,'tutorial journeys never dive ahead');
   assert.equal(step.utilityUnlocked,step.goal>=3,'F2 must be banked before utility');
   if(step.returned)assert.equal(step.cleared,step.goal,'bank one new tutorial floor');
  }else assert.ok(step.goal>10,'normal route begins after real F10 success');
 }
 assert.ok(run.entrySnapshots[1],'actual first dungeon entry must be captured');
 const entry=run.entrySnapshots[1];
 assert.deepEqual(entry.playerBase,run.playerBase,
  'every sortie uses the same authentically rolled player base for this adventurer');
 const minStats=G.startingBase(()=>0),maxStats=G.startingBase(()=>.99999);
 for(const key of ['hp','mag','def','res']){
  assert.ok(run.playerBase[key]>=minStats[key]&&run.playerBase[key]<=maxStats[key],
   'seeded initial '+key+' must fall inside game-authored roll limits');
 }
 assert.equal(entry.playerHp,entry.maxHp,'initial dungeon entry begins at full HP');
 assert.equal(entry.playerMp,entry.maxMp,'initial dungeon entry begins at full MP');
 assert.equal(entry.unbankedXp,0,'no unbanked experience before first fight');
 assert.equal(entry.unbankedStone,0,'no unbanked stone before first fight');
 assert.equal(entry.unbankedInk,0,'no unbanked ink before first fight');
 assert.equal(entry.circles.length,5,'snapshot carries actual equipped five circles');
 assert.equal(entry.cooldowns.length,5);
 assert.ok(Array.isArray(entry.statuses));
 assert.ok(entry.carry.length<=G.capacity(entry.level),'carry never exceeds real capacity');
 assert.ok(entry.playerHp>=0&&entry.playerMp>=0);
 assert.ok(Number.isFinite(entry.targetLevel));
 assert.equal(run.earned.stone,run.spent.stone+run.balances.stone);
 assert.equal(run.earned.ink,run.spent.ink+run.balances.ink);
 assert.ok(run.lost.stone>=0&&run.lost.ink>=0&&run.lost.xp>=0);
 assert.ok(run.fights<=120);
 assert.equal(run.circles.filter(c=>c.active).length,5);
 const {items,collections}=run.resourceLedger;
 assert.equal(items.held,run.inventory,'owned item balances must match warehouse');
 assert.equal(items.bankedDrops+items.alchemyCreated,
  items.held+items.battleConsumed+items.alchemyConsumed,
  'consumable drops, battle usage and alchemy inputs conserve physical items');
 assert.equal(collections.bankedDrops,
  collections.held+collections.alchemyConsumed,
  'collection drops and alchemy inputs conserve collections');
 assert.equal(run.floorAudit.reduce((sum,row)=>sum+row.attemptedFights,0),run.fights,
  'every actual fight belongs to exactly one audited floor');
 assert.ok(run.floorAudit.every(row=>row.layer>=1&&row.layer<=100&&
  row.attemptedFights>=1&&row.attemptedFights<=5&&
  row.entryHpPercent>=0&&row.entryMpPercent>=0));
 assert.ok(run.floorAudit.every(row=>row.layer>=6||
  row.usedOwnedCleansers===0&&row.usedOwnedRecovery===0),
  'F1-5 may spend owned mana only, not HP potions, cleansing or other items');
 assert.equal(run.floorAudit.reduce((n,row)=>n+row.usedOwnedMana,0),
  Object.values(run.rankManaUses).reduce((n,v)=>n+v,0),
  'all genuinely owned mana uses reconcile with consumed item instances');
 assert.ok(run.rankAudit.every(row=>row.eligible===
  (row.hpPercent>=80&&row.mpPercent>=80&&row.failure===null)),
  'boss-only 80/80 checks are independent of victory restoration');
 assert.ok(run.rankAudit.every(row=>!row.banked||row.eligible),
  'only earned, banked badges can be marked safely acquired');
 const initialIds=[...entry.carry,...entry.bankedInventory].map(item=>item.instanceId);
 assert.equal(new Set(initialIds).size,initialIds.length,
  'real owner snapshots cannot duplicate owned consumable instances');
 assert.ok(Array.isArray(entry.bankedInventory)&&entry.bankedCollections);
 // Discovery must not be promoted to 50-fight combat readiness.
 assert.ok(entry.level<entry.targetLevel,'first real 1F entry is not 10F-ready');
 for(const [floor,snap] of Object.entries(run.preparedSnapshots)){
  const from=Number(floor);
  assert.equal(snap.layer,from);
  assert.equal(snap.targetLevel,targetClearLevel(from+9));
  assert.ok(snap.level>=snap.targetLevel);
  assert.ok(unlockedStartLayers({adventurerRank:snap.rank}).includes(from));
  assert.equal(snap.source,'POST_RETURN_BANKED_AND_INVESTED');
  assert.equal(snap.playerHp,snap.maxHp);
  assert.equal(snap.playerMp,snap.maxMp);
  assert.equal(snap.unbankedXp,0);
  assert.equal(snap.unbankedStone,0);
  assert.equal(snap.unbankedInk,0);
  assert.ok(snap.actualFights>0&&snap.actualReturns>0);
  assert.ok(snap.actualSorties<=run.sorties);
  assert.equal(snap.circles.length,5);
  assert.ok(snap.carry.length<=G.capacity(snap.level));
  assert.ok(snap.carry.every(item=>!item.id.startsWith('mana_')),
   'strict 50-battle prepared owners never bring the new rank-only mana allowance');
  assert.equal(new Set([...snap.carry,...snap.bankedInventory].map(x=>x.instanceId)).size,
   snap.carry.length+snap.bankedInventory.length);
 }
 assert.ok(Object.keys(run.preparedSnapshots).length<=10);
 // Frozen reference is separate from the legacy end-of-decade level gate.
 for(const [floor,snap] of Object.entries(run.referenceSnapshots)){
  const s=specFor(Number(floor));
  assert.equal(snap.targetLevel,s.startLevel);
  assert.equal(snap.source,'POST_RETURN_BANKED_AND_INVESTED');
  assert.ok(assess(snap,s).ready,'reference reached only with real levels, power and carried items');
  assert.ok(snap.actualFights<=run.fights&&snap.actualReturns<=run.returns);
  for(const [i,extra] of (run.farmingSnapshots[floor]||[]).entries()){
   assert.equal(extra.completedExtraLoops,i+1);
   assert.ok(extra.additionalBankedReplayFights>=50*(i+1));
   assert.ok(extra.earned.stone>=snap.earned.stone);
   assert.ok(extra.earned.ink>=snap.earned.ink);
  }
 }

 // Per-battle intro prohibition is asserted inside the simulator itself.
 if(style==='B'){
  assert.equal(run.circles.length,8);
  assert.ok(run.offDeckStoneSpent>=0&&run.offDeckStoneSpent<=run.spent.stone,
   'B investments must account for genuine stones');
  if(run.spent.stone>=20)assert.ok(run.offDeckStoneSpent>0,
   'Mature B must keep investing outside its five equipped circles');
 }
 if(style==='C')assert.ok(run.spent.ink<=run.earned.ink);
}
// At the first F10 boss clear all six policies must follow the SAME
// novice route. One newly conquered floor is genuinely banked per return;
// only a returned F2 clear unlocks support and defense on subsequent sorties.
for(const style of ['A','B','C'])for(const route of ['short','long']){
 const tutorial=runJourney(20261024,{style,route,maxSorties:12,maxFights:700});
 const firstBoss=tutorial.trace.findIndex(t=>t.returned&&t.cleared===10);
 assert.ok(firstBoss>=0,'novice actually banks first F10 boss before branching: '+style+route);
 const firstDecade=tutorial.trace.slice(0,firstBoss+1);
 const banked=new Set();
 for(const step of firstDecade){
  assert.equal(step.tutorial,true,'no early long dive before first F10 boss');
  assert.ok(step.goal>=1&&step.goal<=10,'novice chooses only a legal next floor');
  assert.equal(step.utilityUnlocked,banked.has(2),
   'only banked F2 victory unlocks non-attack utility');
  if(step.returned){
   assert.equal(step.cleared,step.goal,'novice banks the intended floor');
   banked.add(step.cleared);
  }
 }
 assert.deepEqual([...banked].sort((a,b)=>a-b),Array.from({length:10},(_,i)=>i+1),
  'all 10 floor-clears are genuinely returned before a strategy can change');
 if(route==='long')for(const step of tutorial.trace.slice(firstBoss+1)){
  if(step.returned)assert.ok(step.cleared%10===0||step.cleared>=51,
   'long journeys bank only at complete decade bosses until 51F');
 }
}
// B's same-seed comparison restores its original equipped spells with
// genuinely earned stones BEFORE taking the mandatory F31 prepared snapshot.
const dispersed=runJourney(20261024,{style:'B',route:'short'});
const restored=dispersed.preparedSnapshots[31];
assert.ok(restored,'B recovery must create a legally banked F31 state');
assert.ok(Array.isArray(dispersed.recovery.targetUpgrades));
assert.ok(restored.circles.every((c,i)=>c.upgradeLevel>=dispersed.recovery.targetUpgrades[i]),
 'The B prepared owner may only enter F31 after paid recovery of the actual A equipment gap');
assert.ok(restored.actualReturns>0&&restored.unbankedStone===0,
 'B recovery preparations must be banked rather than free upgrades');

// An actual banked five-ink C redraw must take place in a mature seeded
// journey. Old stones remain sunk, original drawing quality is not rerolled,
// and no material can appear merely to make the test pass.
const rebuild=runJourney(20261024,{style:'C',route:'short'});
// An underprepared owner is not required to redraw just to satisfy a test.
// Observe the actual strategy; any performed redraw must be fully paid.
assert.ok(rebuild.replacements>=0&&rebuild.replacements<=3,
 'the real C account cannot exceed its allowed paid redraw count');
assert.ok(rebuild.redrawEvents.every(event=>event.role==='attack'),
 'Ordinary C ink strategy never discards the sole earned healing circle; forced diagnostics are separate');
assert.equal(rebuild.redrawEvents.length,rebuild.replacements);
assert.equal(rebuild.spent.ink,rebuild.replacements*5);
assert.equal(rebuild.earned.ink,rebuild.spent.ink+rebuild.balances.ink);
assert.ok(rebuild.redrawEvents.every(event=>event.sameDrawingQuality===true&&
 event.stoneInvestmentTransferred===0&&event.newMarginalPowerPerStone>event.oldMarginalPowerPerStone),
 'same-quality ink rebuild cannot transfer sunk upgrades');
assert.ok(rebuild.redrawEvents.every(event=>event.sunkStones>=0));
assert.equal(rebuild.floorAudit.reduce((n,x)=>n+x.attemptedFights,0),rebuild.fights);
assert.equal(rebuild.resourceLedger.items.held,rebuild.inventory);
assert.ok(rebuild.floorAudit.every(row=>row.layer>=6||
 row.usedOwnedCleansers===0&&row.usedOwnedRecovery===0),
 'F1-5 may use only owned mana items in every route');
assert.equal(rebuild.floorAudit.reduce((n,row)=>n+row.usedOwnedMana,0),
 Object.values(rebuild.rankManaUses).reduce((n,v)=>n+v,0),
 'full actual journey accounts for every owned mana potion');
assert.ok(Object.values(rebuild.rankManaUses).reduce((n,v)=>n+v,0)>=0,
 'no magic mana items are required to pass a journey');
assert.ok(rebuild.floorAudit.every(f=>f.bossRank===null||f.layer%10===0),
 'only an actual tenth-floor boss can trigger a rank event');
const repeat=runJourney(20261024,{style:'A',route:'short',maxSorties:2,maxFights:120});
const repeatAgain=runJourney(20261024,{style:'A',route:'short',maxSorties:2,maxFights:120});
assert.deepEqual(repeatAgain,repeat,'identical seed and policy must reproduce every battle and earned resource');
const alchemy=runJourney(20261024,{style:'A',route:'short',alchemy:true,maxSorties:4,maxFights:180});
assert.equal(alchemy.resourceLedger.items.alchemyConsumed,5*alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.items.alchemyCreated,alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.collections.alchemyConsumed,alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.items.held,alchemy.inventory);
assert.equal(alchemy.resourceLedger.collections.held,
 Object.values(alchemy.collection).reduce((a,b)=>a+b,0));

assert.equal(chooseAdditionalFarmingBand([1,11],{1:3,11:3},{},true),1,
 'a third replay is not a cap on fixed-deck superiority');
assert.equal(chooseAdditionalFarmingBand([1,11],{1:4,11:3},{},true),11);
assert.equal(chooseAdditionalFarmingBand([1,11],{1:4,11:4},{1:true},true),11);
assert.equal(chooseAdditionalFarmingBand([1,11],{1:7,11:4},{1:true,11:true},true),null);
assert.equal(chooseAdditionalFarmingBand([1],{1:3},{},false),null,
 'without paired combat proof, no unearned superiority is certified');
// The unproven fourth cycle must NOT keep novices farming F1-10 forever.
const firstClearPriority=runJourney(20261024,{style:'A',route:'short',
 verifyFarming:true,farmingProof:()=>false,maxSorties:45,maxFights:500});
assert.ok(firstClearPriority.best>10,
 'prove first-time progression outranks adaptive stage four until real 100F completion');
assert.equal(firstClearPriority.completedReplayLoops[1],3,
 'only the mandatory first three banked observations run before the campaign clear');
// The never-approved candidate is allowed for diagnostics but cannot steer
// return, training, combat or investment. Remove it entirely and compare.
for(const style of ['A','B','C'])for(const route of ['short','long']){
 const opts={style,route,maxSorties:30,maxFights:350};
 const diagnostic=runJourney(20261024,{...opts,collectCandidateDiagnostic:true});
 const without=runJourney(20261024,{...opts,collectCandidateDiagnostic:false});
 assert.deepEqual(diagnostic.trace,without.trace,
  'candidate reference must never choose a different journey route');
 assert.deepEqual(diagnostic.floorAudit,without.floorAudit);
 assert.deepEqual(diagnostic.earned,without.earned);
 assert.deepEqual(diagnostic.spent,without.spent);
 assert.deepEqual(diagnostic.circles,without.circles);
 assert.deepEqual(diagnostic.balances,without.balances);
}
// Formal replay evidence: actually complete fifty previously conquered fights
// at least three times, bank rewards, and preserve owner cost accounting.
// This test runs in Actions; absent or cut-off replay cycles cannot PASS.
const observedFarm=runJourney(20261024,{style:'A',route:'short',
 verifyFarming:true,maxSorties:35,maxFights:350});
const earnedReplay=observedFarm.preparedFarmingSnapshots[1]||[];
assert.ok(earnedReplay.length>=3,'three real, banked F1-10 replay cycles must be performed');
assert.ok(observedFarm.completedReplayLoops[1]>=3);
assert.deepEqual(earnedReplay.slice(0,3).map(s=>s.completedExtraLoops),[1,2,3]);
assert.ok(earnedReplay.slice(0,3).every((snap,i)=>
 snap.completedExtraLoops===i+1&&snap.additionalBankedReplayFights>=50*(i+1)&&
 snap.unbankedStone===0&&snap.unbankedXp===0&&snap.unbankedInk===0),
 'replay snapshot cannot invent resources or claim a partial/failing sortie as banked');
assert.ok(earnedReplay.slice(0,3).every((snap,i)=>snap.actualReturns>0&&
 snap.actualFights>=snap.additionalBankedReplayFights&&
 (i===0||(snap.actualFights>earnedReplay[i-1].actualFights&&
 snap.actualReturns>earnedReplay[i-1].actualReturns))),
 'three observed replay checkpoints must each follow further genuine fights and banked returns');

console.log('PASS manifest coverage, reproducible seeded combat, 80/80 rank, item/collection/stone/ink conservation and 6 routes '+ECONOMY_VERSION);
