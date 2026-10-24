// Counterfactual ten-layer challenge from ONE real owner state per band.
// Unlike a fabricated per-field median, level, spells, carry, current HP/MP
// and pending resources come from the SAME seeded economy account and sortie.
// This is an honest diagnostic, not a substitute for a user-approved frozen
// 256-seed acceptance baseline or for measuring time-to-readiness.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {spread} from './simulate-dungeon-journeys.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';

const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const csv=p=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+p+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),
 enemies:csv('enemies'),buffs:csv('buffs'),collections:csv('collections')};
configure(data);
const economy=read('reports/dungeon-journeys-v1.json');
const goals=read('config/dungeon-approved-goals.v1.json');
assert.equal(goals.strictSamples,256,'No weakening the approved sample count');

// Canonical owner combat is shared with the full 256-account validator.
function quantize(xs){return spread(xs);}
const results={version:'actual-owner-consecutive-combat-v1',economy:economy.schemaVersion,
 economySeed:economy.seed,sourceSamples:economy.samples,
 combatSamples:goals.strictSamples,combatSeedRule:'17011+13*i',cases:[],warnings:[],
 methodology:'same-owner first-entry current HP, MP, cooldown, all five spells, and owned usable stock; replay a 50-fight challenge without shopping, level-up, loot banking, or auto-healing between layers. Independent from approved frozen benchmark.',
 status:'DIAGNOSTIC_NOT_ACCEPTANCE'};
for(const cohort of economy.combinations){
 if(!cohort.comparisonStates)throw Error('Missing complete economic owner states');
 for(const band of goals.bands){
  const owners=cohort.comparisonStates.map(x=>({seed:x.seed,snapshot:x.snapshots[band.from]}))
   .filter(x=>x.snapshot&&x.snapshot.playerHp>0);
  if(!owners.length){
   results.cases.push({route:cohort.route,style:cohort.style,band:band.from,
    status:'NO_REAL_ENTRY',owners:0});
   continue;
  }
  // Pick the median observed *player*, not separately medianised stats that
  // would fabricate a character who never existed.
  owners.sort((a,b)=>a.snapshot.level-b.snapshot.level||a.seed-b.seed);
  const median=owners[Math.floor((owners.length-1)/2)];
  const actual=median.snapshot;
  const trials=Array.from({length:goals.strictSamples},(_,i)=>
   challenge(actual,band.from,17011+13*i));
  const wins=trials.filter(x=>x.won);
  const winRate=100*wins.length/trials.length;
  const mp=quantize(wins.map(x=>x.endMp));
  const hp=quantize(wins.map(x=>x.endHp));
  const issues=[];
  if(winRate<band.winRate[0]||winRate>band.winRate[1])issues.push('observed win% outside approved range');
  if(winRate<band.winSafety[0]||winRate>band.winSafety[1])issues.push('observed win% outside approved safety band');
  if(mp.median===null||mp.median<band.winnerMedianMp[0]||mp.median>band.winnerMedianMp[1])
   issues.push('winner MP median outside approved range');
  if(band.from>=51&&!actual.carry.length)issues.push('missing owned prestock of status cleansers');
  const row={route:cohort.route,style:cohort.style,band:band.from+'-'+band.to,
   status:'MEASURED_NOT_CERTIFIED',sourceOwnerSeed:median.seed,owners:owners.length,
   samples:goals.strictSamples,wins:wins.length,winRate,mp,hp,
   starting:{level:actual.level,rank:actual.rank,
    hpPercent:100*actual.playerHp/actual.maxHp,
    mpPercent:100*actual.playerMp/actual.maxMp,
    upgradeLevels:actual.circles.map(x=>x.upgradeLevel),
    effectivePowers:actual.circles.map(x=>x.power),
    carry:actual.carry.map(x=>x.id),
    bankedStone:actual.bankedStones,bankedInk:actual.bankedInk,
    unbankedXp:actual.unbankedXp,unbankedStone:actual.unbankedStone,
    unbankedInk:actual.unbankedInk},
   rank:{eligibleOnWinningBoss:wins.filter(x=>x.bossRankEligible).length,
    bossPreRecoveryMp:quantize(wins.filter(x=>x.bossPreRecovery).map(x=>x.bossPreRecovery.mp)),
    bossPreRecoveryHp:quantize(wins.filter(x=>x.bossPreRecovery).map(x=>x.bossPreRecovery.hp))},
   heals:quantize(trials.map(x=>x.heals)),
   usedItems:trials.reduce((n,r)=>n+Object.values(r.used).reduce((a,b)=>a+b,0),0),
   firstLosses:Object.entries(trials.filter(x=>!x.won).reduce((a,x)=>
    (a[x.firstLoss]=(a[x.firstLoss]||0)+1,a),{})),
   unmet:issues,metHardGoalsInThisCounterfactual:issues.length===0};
  results.cases.push(row);
  console.log('DUNGEON_ACTUAL_OWNER_COMBAT '+JSON.stringify({
   route:row.route,style:row.style,band:row.band,level:row.starting.level,
   hpStart:row.starting.hpPercent,mpStart:row.starting.mpPercent,
   stock:row.starting.carry.length,wins:row.wins,winRate:row.winRate,
   medianWinnerMp:row.mp.median,rankEligible:row.rank.eligibleOnWinningBoss,
   issues:row.unmet
  }));
 }
}
results.warnings.push('This is a 50-fight counterfactual starting at the exact first entry; short-route players normally bank and grow BETWEEN layers. Failure here does not mean their observed journey never progresses.');
results.warnings.push('A first entry with low level or depleted MP is not secretly repaired into a prepared state; preparation recovery remains a separate economic metric.');
const checked=results.cases.filter(x=>x.status==='MEASURED_NOT_CERTIFIED');
results.summary={checked:checked.length,met:checked.filter(x=>x.metHardGoalsInThisCounterfactual).length,
 unmet:checked.filter(x=>!x.metHardGoalsInThisCounterfactual).length,
 missing:results.cases.length-checked.length,
 noOwnedCleansers:checked.filter(x=>Number(x.band.split('-')[0])>=51&&x.starting.carry.length===0).length};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-actual-owner-combat-v1.json',import.meta.url),
 JSON.stringify(results,null,2)+'\n');
console.log('DUNGEON_ACTUAL_OWNER_SUMMARY '+JSON.stringify(results.summary));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Actual owner first-entry 50-fight diagnostics (not frozen acceptance)\n'+
 results.cases.map(x=>x.status!=='MEASURED_NOT_CERTIFIED'
 ?x.style+'/'+x.route+' '+x.band+'F missing\n'
 :x.style+'/'+x.route+' '+x.band+'F: '+x.winRate.toFixed(1)+
 '% win, MP '+(x.mp.median===null?'n/a':x.mp.median.toFixed(1))+
 '%, Lv'+x.starting.level+', start MP '+x.starting.mpPercent.toFixed(1)+
 '%, owned stock '+x.starting.carry.length+'\n').join('')+
 '\nThese snapshots do not replace the unchanged strict 256-seed hard gates.\n');
