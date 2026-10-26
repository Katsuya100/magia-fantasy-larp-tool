// Canonical fixed-deck comparator shared by strict build growth and adaptive
// earned replay assessment. The reference circles are NEVER owner resources.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
import {upgradeSpells} from '../tests/test-dungeon-progression-simulation.mjs';
import {withNeutralAttackAttributes} from '../tests/helpers/dungeon-neutral-loadout.mjs';
import {assertPairedCharacters} from './dungeon-test-contract.mjs';
const goals=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
const enemyMaster=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
const INTRO=[['attack','flame',220],['attack','bolt',260],['attack','gravity',300],
 ['support','aqua',200],['defense','law',160]];
const NORMAL=[['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]];
const sources=goals.bands.map(b=>withNeutralAttackAttributes(
 (b.from===1?INTRO:NORMAL).map(([role,attribute,power])=>({role,attribute,power})),
 enemyMaster,b.from,b.to).spells);
const milestoneLedger=Array.from({length:goals.strictSamples},(_,i)=>
 simulateProgression(17011+i*13+81).milestones);
export const referenceSpells=goals.bands.map((band,k)=>
 Array.from({length:goals.strictSamples},(_,i)=>{
  const prior=band.from-1;
  const stones=prior===0?0:milestoneLedger[i].find(row=>row.layer===prior)?.stones;
  assert.ok(Number.isFinite(stones),'fixed deck must use measured original stone ledger');
  const rate=band.from<=10?.25:band.from<=20?.25+(band.from-10)*.05:.75;
  return upgradeSpells(sources[k],Math.floor(stones*rate+1e-8)).spells;
 }));
export function pairedAdvantage(actual,fixed){
 if(actual.won&&!fixed.won)return 'WIN_ADVANTAGE';
 if(!actual.won||!fixed.won)return null;
 const differences=[
  actual.endHp-fixed.endHp,actual.endMp-fixed.endMp,
  fixed.casts-actual.casts,fixed.spellMpSpent-actual.spellMpSpent
 ];
 const tolerance=1e-8;
 return differences.every(x=>x>=-tolerance)&&differences.some(x=>x>tolerance)
  ?'PARETO_ADVANTAGE':null;
}
export function evaluatePaidBuild(snapshot,index,seedIndex,cache=null){
 const band=goals.bands[index];
 assert.ok(band&&seedIndex>=0&&seedIndex<goals.strictSamples);
 // Memoize only identical battle-affecting conditions. Instance IDs do not
 // change potion effects; their real acquisition is verified by the ledger.
 const key=cache?JSON.stringify({index,seedIndex,level:snapshot.level,
  rank:snapshot.rank,playerBase:snapshot.playerBase,
  circles:snapshot.circles.map(c=>[c.role,c.attribute,c.power,c.basePower,c.upgradeLevel]),
  carry:snapshot.carry.map(x=>[x.id,x.value,x.bonus])}):null;
 if(cache?.has(key))return cache.get(key);
 const hero=G.makeUnit(snapshot.playerBase,snapshot.level,{},snapshot.circles,'hero');
 const shared={...snapshot,playerHp:hero.stats.hp,playerMp:hero.maxMp,
  maxHp:hero.stats.hp,maxMp:hero.maxMp,statuses:[],
  cooldowns:snapshot.circles.map(()=>0)};
 const fixedOwner={...shared,circles:referenceSpells[index][seedIndex]};
 assertPairedCharacters(shared,fixedOwner);
 const combatSeed=37011+13*seedIndex;
 const actual=challenge(shared,band.from,combatSeed,{route:'short',paired:true});
 const fixed=challenge(fixedOwner,band.from,combatSeed,{route:'short',paired:true});
 const common=Math.min(actual.opponents.length,fixed.opponents.length);
 assert.deepEqual(actual.opponents.slice(0,common),fixed.opponents.slice(0,common),
  'same enemy encounters are compulsory for paired build proof');
 const result={actual,fixed,advantage:pairedAdvantage(actual,fixed)};
 if(cache)cache.set(key,result);
 return result;
}
