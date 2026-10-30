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
 assert.ok(Number.isFinite(earned)&&earned>=1/45,'finite scaled XP '+layer);
 G.experience(normal,earned);
 assert.equal(normal.level,targetClearLevel(layer+1),
  'player continues to gain levels past the final authored growth row');
}
assert.equal(normal.level,151,'a normal first-clear journey continues through level 150');
// Actual expedition path: rewards are added five times before every return.
// A fractional 0.2/0.4 EXP reward must not leave the hero one level short.
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


// Needed XP should climb sharply across level bands, without an abrupt
// permanent advantage for collecting low-level enemy kills.
assert.equal(G.nextXp(1),3,'scaled first-level threshold');
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
assert.ok(G.nextXp(149)<100000,'the redesigned late-game curve keeps required XP below six digits');
assert.equal(G.formatXp(121.40000000000002),'121.4','combat EXP display hides floating point noise');
assert.equal(G.formatXp(12345.67),'12,345.7','EXP keeps its real units with one decimal at most');
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
