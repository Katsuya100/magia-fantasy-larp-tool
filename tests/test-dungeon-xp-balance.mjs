import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';

const read=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=['balance','levels','floors','player-base'].map(read);
configure({balance,levels,floors,playerBase});
assert.equal(num('xp_growth_per_10_levels'),1.85,'steeper pre-100 EXP growth');
assert.equal(num('xp_growth_per_10_levels_late'),1.1,'tapered late EXP growth');
assert.ok(!balance.some(row=>row.key==='xp_overlevel_decay_per_10_levels'),
 'deleted EXP decay parameter must not be reintroduced');

// At-level adventurers should still reach the recommended level for the
// next layer after five victories followed by a safe return.
const normal={level:1,xp:0};
for(let layer=1;layer<=100;layer++){
 const intended=targetClearLevel(layer);
 assert.equal(normal.level,intended,'start level for layer '+layer);
 const earned=5*G.fightExperience(intended,normal.level,layer);
 assert.ok(Number.isSafeInteger(earned)&&earned>=1,'integer XP '+layer);
 G.experience(normal,earned);
 assert.equal(normal.level,targetClearLevel(layer+1),
  'player continues to gain levels past the final authored growth row');
}
assert.equal(normal.level,151,'a normal first-clear journey continues through level 150');
// Actual expedition path: rewards are added five times before every return.
// Per-battle integer XP accumulates exactly with no rounding residue.
const incremental={level:1,xp:0};
for(let layer=1;layer<=100;layer++){
 const expectedStart=targetClearLevel(layer);
 assert.equal(incremental.level,expectedStart,'exact start level after all previous fight-by-fight returns at layer '+layer);
 let pending=0;
 for(let fight=0;fight<5;fight++)
  pending=G.normalizeXp(pending+G.fightExperience(expectedStart,incremental.level,layer));
 G.experience(incremental,pending);
 assert.equal(incremental.level,targetClearLevel(layer+1),
  'fight-by-fight EXP awards precisely finish layer '+layer);
 assert.equal(incremental.xp,0,'no floating XP residue at the level threshold of layer '+layer);
}


// All five encounters in every authored layer own explicit whole-number
// rewards. The level master owns the matching whole-number thresholds.
assert.equal(G.XP_SCALE,46);
// The fivefold values are authored in the CSV, never calculated at play time.
// Reject future data drift even if all results remain technically integers.
const priorXpRequirement=level=>{
 const row=levels[level-1],steps=(level-1)/10;
 return Math.ceil(Number(row.xp_to_next)*
  Math.pow(num('xp_growth_per_10_levels'),Math.min(steps,9.9))*
  Math.pow(num('xp_growth_per_10_levels_late'),Math.max(0,steps-9.9))/45);
};
for(const row of levels)assert.equal(Number(row.xp_integer_to_next),
 5*priorXpRequirement(Number(row.level)),
 'authored fivefold threshold must preserve the old level curve at Lv'+row.level);
for(let layer=1;layer<=100;layer++){
 const start=targetClearLevel(layer),end=targetClearLevel(layer+1);
 let budget=0;
 if(end>start)for(let level=start;level<end;level++)budget+=priorXpRequirement(level);
 else budget=priorXpRequirement(start);
 for(let index=0;index<5;index++)
  assert.equal(Number(floors[(layer-1)*5+index].xp_reward),budget,
   'authored individual reward must preserve historical layer budget for fight '+((layer-1)*5+index+1));
}
assert.equal(levels.length,150,'every authored level must be checked');
assert.equal(floors.length,500,'every authored battle must be checked');
for(const row of levels){
 assert.match(String(row.xp_integer_to_next),/^[1-9][0-9]*$/,'whole-number level data, Lv'+row.level);
 assert.equal(G.nextXp(Number(row.level)),Number(row.xp_integer_to_next));
 assert.ok(Number.isSafeInteger(G.nextXp(Number(row.level))));
}
for(const row of floors){
 assert.match(String(row.xp_reward),/^[1-9][0-9]*$/,'whole-number battle data, fight '+row.floor);
 const fight=Number(row.floor),layer=Math.ceil(fight/5);
 const reward=G.fightExperience(Number(row.enemy_level),1,layer,fight);
 assert.equal(reward,Number(row.xp_reward),'individual encounter '+fight);
 assert.ok(Number.isSafeInteger(reward)&&reward>0,'positive whole EXP at fight '+fight);
}
const singleVictory={xp:0};
assert.equal(G.earnFightExperience(singleVictory,1,1,1,1),Number(floors[0].xp_reward));
assert.equal(singleVictory.xp,Number(floors[0].xp_reward));
assert.equal(G.normalizeXp(2),2);
for(const invalid of [0.2,1.5,2.39999999999999,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2']){
 assert.throws(()=>G.normalizeXp(invalid),/整数/,'fractional or unsafe EXP must fail, never round: '+invalid);
}
const badRun={xp:2.5};
assert.throws(()=>G.earnFightExperience(badRun,1,1,1,1),/整数/,
 'new battle reward must not conceal an already-corrupt expedition XP');
assert.equal(badRun.xp,2.5,'failed battle accumulation does not overwrite existing progress');
const badProfile={level:1,xp:2.5};
assert.throws(()=>G.experience(badProfile,1),/整数/);
assert.deepEqual(badProfile,{level:1,xp:2.5},'failed level calculation must not mutate player progress');
assert.throws(()=>G.experience({level:1,xp:0},0.2),/整数/,
 'fractional reward must be rejected even when the sum could be an integer');
const badLevelData=levels.map((row,i)=>i?row:{...row,xp_integer_to_next:'2.5'});
configure({balance,levels:badLevelData,floors,playerBase});
assert.throws(()=>G.nextXp(1),/整数/,'fractional level CSV must be rejected at runtime');
const badBattleData=floors.map((row,i)=>i?row:{...row,xp_reward:'0.2'});
configure({balance,levels,floors:badBattleData,playerBase});
assert.throws(()=>G.fightExperience(1,1,1,1),/整数/,'fractional battle CSV must be rejected at runtime');
const missingBattleData=floors.map((row,i)=>i?row:{...row,xp_reward:''});
configure({balance,levels,floors:missingBattleData,playerBase});
assert.throws(()=>G.fightExperience(1,1,1,1),/整数/,'missing battle reward must not silently fall back');
configure({balance,levels,floors,playerBase});
for(const fight of [501,505,512,777]){
 const reward=G.fightExperience(150,150,Math.ceil(fight/5),fight);
 assert.ok(Number.isSafeInteger(reward)&&reward>0,'generated fight '+fight+' has whole EXP');
}

// Needed XP should climb sharply across level bands, without an abrupt
// permanent advantage for collecting low-level enemy kills.
assert.equal(G.nextXp(1),15,'authored integer first-level threshold');
for(const level of [10,20,30,40,60,80,100,120,139]){
 assert.ok(G.nextXp(level+10) >=G.nextXp(level)*1.15,
  'ten levels are substantially more expensive at '+level);
}
assert.ok(G.nextXp(100)>G.nextXp(20)*5,'late-game XP increases without runaway inflation');
assert.ok(G.nextXp(150)<Number.MAX_SAFE_INTEGER,'level-cap XP remains safe');
assert.ok(G.fightExperience(150,150,100)>0,'level 150 can continue earning XP');
assert.equal(G.fightExperience(150,151,100),G.fightExperience(150,150,100),
 'EXP never decays after crossing level 150');
assert.ok(G.fightExperience(150,149,100)>0,'below-cap characters can still gain XP from the final boss');
const uncapped={level:149,xp:0};
G.experience(uncapped,G.nextXp(149)+G.nextXp(150));
assert.deepEqual(uncapped,{level:151,xp:0},'EXP advances through level 150 without loss');

// Every lower-floor repeat awards the same per-battle XP at any player
// level below the level cap.  This is a permanent regression of the
// deliberately removed EXP decay system, NOT a target-combat shortcut.
for(const layer of [1,3,10,20,50,80,99]){
 const enemy=targetClearLevel(layer);
 const baseline=G.fightExperience(enemy,enemy,layer);
 assert.ok(baseline>0,'a layer yields positive XP');
 for(const playerLevel of [1,enemy,Math.min(149,enemy+1),Math.min(149,enemy+15),149])
  assert.equal(G.fightExperience(enemy,playerLevel,layer),baseline,
   'XP must not diminish for low-floor repeats at layer '+layer+' and level '+playerLevel);
}
assert.ok(G.fightExperience(139,139,90)>G.fightExperience(19,19,10)*15,
 'endgame enemy rewards must be worth considerably more than early monsters');

// Thirty actual repeat clears award unreduced XP. The level obtained is
// measured rather than restricted by an invented or revived decay limit.
const farmer={level:30,xp:0};
let total=0;
for(let run=0;run<30;run++){
 for(let layer=1;layer<=10;layer++){
  const enemy=targetClearLevel(layer);
  const reward=5*G.fightExperience(enemy,farmer.level,layer);
  total+=reward;
  G.experience(farmer,reward);
 }
}
assert.ok(farmer.level>30&&farmer.level<=150,'repeated farming increases XP without artificial penalties');
assert.ok(total>G.nextXp(30),'repeated farming rewards remain meaningful');

// Repeating nearby floors should produce meaningful XP while distinctly
// outperforming trivial layers for a level-30 adventurer.
const nearbyFarmer={level:30,xp:0};
for(let run=0;run<10;run++){
 for(let layer=11;layer<=15;layer++){
  const enemy=targetClearLevel(layer);
  G.experience(nearbyFarmer,5*G.fightExperience(enemy,nearbyFarmer.level,layer));
 }
}
assert.ok(nearbyFarmer.level>30&&nearbyFarmer.level<=150,'nearby replay remains useful');
assert.ok(G.fightExperience(targetClearLevel(15),80,15)>G.fightExperience(targetClearLevel(1),80,1),
 'deeper layers reward more XP without level penalties');

// Higher-level dungeons keep their authored XP value without suppressing lower ones.
const farmedLevel=farmer.level;
const before=farmer.level;
G.experience(farmer,5*G.fightExperience(37,farmer.level,20));
assert.ok(farmer.level>=before,'the correct challenge awards viable XP');
// Explicit diagnostics for overleveled replay. These are characterization
// tests, not approval of the high replay percentage or a new XP nerf.
const replayCases=[
 {level:30,from:1,to:10},
 {level:50,from:11,to:20},
 {level:92,from:41,to:41},
 {level:120,from:51,to:60}
];
const replayDiagnostics=replayCases.map(({level,from,to})=>{
 const p={level,xp:0};
 let earned=0;
 for(let layer=from;layer<=to;layer++)
  earned+=5*G.fightExperience(targetClearLevel(layer),level,layer);
 G.experience(p,earned);
 return {level,layers:from===to?String(from):from+'-'+to,
  earned,needed:G.nextXp(level),
  gaugePercent:100*earned/G.nextXp(level),afterLevel:p.level,afterXp:p.xp};
});
const level92Replay=replayDiagnostics.find(x=>x.level===92);
const full41Replay=5*G.fightExperience(targetClearLevel(41),targetClearLevel(41),41);
assert.equal(level92Replay.earned,full41Replay,
 '41F five battles award equal EXP irrespective of player overlevel');
assert.ok(G.nextXp(149)<500000,'the five-unit integer threshold keeps the same late-game progression');
assert.equal(G.formatXp(121),'121','combat EXP display is integer-only');
assert.equal(G.formatXp(12345),'12,345','EXP display has no decimal digits');
assert.throws(()=>G.formatXp(12345.67),/整数/,'UI must reveal bad fractional values rather than hiding them');
console.log('XP_REPLAY_DIAGNOSTICS '+JSON.stringify(replayDiagnostics));
console.log('XP_BAND_BALANCE '+JSON.stringify({
 firstLayerLevel:3,levelAfter100:normal.level,lowFloorRuns:30,
 lowFloorLevel:farmedLevel,nearbyFloorRuns:10,nearbyFloorLevel:nearbyFarmer.level,
 afterSuitableChallenge:farmer.level,lowFloorTotalXp:total,
 lvl30Needed:G.nextXp(30),lvl44Needed:G.nextXp(44),
 lvl100Needed:G.nextXp(100),lvl150Needed:G.nextXp(150)
}));
assert.doesNotMatch(readFileSync(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8'),/EXP MAX/,
 'the profile no longer shows a level-150 EXP cap');
console.log('PASS level-band XP growth, 100-layer targets and never-decaying replay awards');
