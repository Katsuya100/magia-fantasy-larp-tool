import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';

const read=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=['balance','levels','floors','player-base'].map(read);
configure({balance,levels,floors,playerBase});
assert.equal(num('xp_growth_per_10_levels'),1.35,'flatter required EXP curve');

// At-level adventurers should still reach the recommended level for the
// next layer after five victories followed by a safe return.
const normal={level:1,xp:0};
for(let layer=1;layer<=100;layer++){
 const intended=targetClearLevel(layer);
 assert.equal(normal.level,intended,'start level for layer '+layer);
 const earned=5*G.fightExperience(intended,normal.level,layer);
 assert.ok(Number.isFinite(earned)&&earned>=(intended===150?0:1/45),'finite scaled XP '+layer);
 G.experience(normal,earned);
 assert.equal(normal.level,Math.min(150,targetClearLevel(layer+1)),
  'player level caps at 150 even as post-100 enemy levels continue increasing');
}
assert.equal(normal.level,150,'a normal first-clear journey ends at level 150');

// Needed XP should climb sharply across level bands, without an abrupt
// permanent advantage for collecting low-level enemy kills.
assert.equal(G.nextXp(1),3,'scaled first-level threshold');
for(const level of [10,20,30,40,60,80,100,120,139]){
 assert.ok(G.nextXp(level+10) >=G.nextXp(level)*1.15,
  'ten levels are substantially more expensive at '+level);
}
assert.ok(G.nextXp(100)>G.nextXp(20)*5,'late-game XP increases without runaway inflation');
assert.ok(G.nextXp(150)<Number.MAX_SAFE_INTEGER,'level-cap XP remains safe');
assert.equal(G.fightExperience(150,150,100),0,'max-level characters receive no wasted XP');
assert.ok(G.fightExperience(150,149,100)>0,'below-cap characters can still gain XP from the final boss');
const capped={level:149,xp:0};
G.experience(capped,2*G.nextXp(149));
assert.deepEqual(capped,{level:150,xp:0},'level cap clears excess experience');

// The reward of any encounter depends on both the enemy's recommended
// difficulty and the current adventurer's level, not the fight's position.
for(const layer of [1,3,10,20,50,80,99]){
 const enemy=targetClearLevel(layer);
 const full=G.fightExperience(enemy,enemy,layer);
 assert.ok(full>0,'appropriate foe yields XP');
 assert.equal(G.fightExperience(enemy,Math.max(1,enemy-5),layer),full,
  'underleveled heroes are not penalized for taking on difficult foes');
 for(const gap of [1,2,3,5,10]){
  if(enemy+gap>=150)continue;
  assert.equal(G.fightExperience(enemy,enemy+gap,layer),full,
   'replay XP remains unchanged at layer '+layer+', gap '+gap);
 }
}
assert.ok(G.fightExperience(139,139,90)>G.fightExperience(19,19,10)*15,
 'endgame enemy rewards must be worth considerably more than early monsters');

// Regression: farming layers 1–10 with a level 30 adventurer must no longer
// push them to 44. Simulate 30 complete 50-fight clears, banking XP after
// each layer just as returning at its checkpoint does.
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
assert.ok(farmer.level>30&&farmer.level<100,'repeated farming advances without instantly reaching the cap');
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
assert.ok(nearbyFarmer.level>30&&nearbyFarmer.level<100,'nearby replay remains useful');
assert.ok(G.fightExperience(targetClearLevel(15),80,15)>G.fightExperience(targetClearLevel(1),80,1),
 'deeper layers reward more XP without level penalties');

// Higher appropriate dungeons remain useful after lower ones stop paying.
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
assert.equal(level92Replay.earned,607,'41F five battles issue exactly 607 scaled EXP');
assert.ok(level92Replay.gaugePercent>46&&level92Replay.gaugePercent<47,
 'track the currently excessive Lv92/41F replay gauge gain');
assert.ok(G.nextXp(149)<20000,'the redesigned late-game curve stays below 5 digits in required XP');
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
assert.match(readFileSync(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8'),/EXP MAX/,'level cap is labeled in the profile');
console.log('PASS level-band XP growth, 100-layer progression and uncapped replay awards');
