// A review-only, reproducible proposal. NEVER write the active/frozen config,
// and NEVER evaluate strict combat against dynamically refreshed medians.
// The source economic measurements and seed are pinned in this output.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const measurement=read('reports/dungeon-journeys-v1.json');
const frozen=read('config/dungeon-economy-baseline-candidate.v1.json');
const bands=[];
for(const route of ['short','long']){
 const cohort=measurement.combinations.find(x=>x.style==='A'&&x.route===route);
 if(!cohort?.comparisonStates)throw Error('Economy must contain real individual owner snapshots');
 for(let i=0;i<10;i++){
  const from=i*10+1,to=from+9,base=frozen.routes[route][i];
  const real=cohort.comparisonStates.map(x=>({seed:x.seed,state:x.snapshots[from]}))
   .filter(x=>x.state&&Number.isSafeInteger(x.state.level));
  if(!real.length)throw Error('No measured owner for '+route+' '+from);
  real.sort((a,b)=>a.state.level-b.state.level||a.seed-b.seed);
  const representative=real[Math.floor((real.length-1)/2)];
  const aggregate=cohort.checkpoints[i].firstEntry;
  const proposed={from,to,level:Math.round(aggregate.level.median),
   upgradeLevels:aggregate.upgrades.map(d=>Math.round(d.median))};
  const change=base.level!==proposed.level||
   base.upgradeLevels.some((x,j)=>x!==proposed.upgradeLevels[j]);
  bands.push({route,from,to,accounts:real.length,comparison:{
   existingFrozen:{level:base.level,upgradeLevels:base.upgradeLevels},
   measuredMedianProposal:proposed,requiresReview:change},
   observedDistribution:{level:aggregate.level,levelGap:aggregate.levelGap,
    bankStone:aggregate.stoneBalance,bankInk:aggregate.inkBalance,
    power:aggregate.powers,upgrade:aggregate.upgrades},
   indivisibleRealOwnerReference:{seed:representative.seed,
    level:representative.state.level,rank:representative.state.rank,
    carry:representative.state.carry,
    playerHp:representative.state.playerHp,
    playerMp:representative.state.playerMp,
    maxHp:representative.state.maxHp,maxMp:representative.state.maxMp,
    spells:representative.state.circles,
    bankedStones:representative.state.bankedStones,
    bankedInk:representative.state.bankedInk,
    unbankedStone:representative.state.unbankedStone,
    unbankedInk:representative.state.unbankedInk,
    unbankedXp:representative.state.unbankedXp}});
 }
}
const output={schemaVersion:'dungeon-economic-baseline-review-proposal-v3',
 status:'MEASURED_REVIEW_ONLY_NOT_USER_APPROVED',
 currentFrozen:frozen.schemaVersion,source:measurement.schemaVersion,
 economySeed:measurement.seed,economySamples:measurement.samples,
 changeCount:bands.filter(b=>b.comparison.requiresReview).length,
 neitherBaselineNorSourceAutoupdated:true,
 notes:['These are only proposals; no consumer may treat this file as an accepted strict combat reference.',
  'Per-field medians can describe no real player; each band includes a coherent actual-owner reference too.',
  'Long-route HP/MP and carried inventory are from actual entry; no full restoration on band changes.',
  'The existence of a proposed loadout does NOT mean it has passed readiness or combat targets.'],
 bands};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-baseline-review-proposal-v3.json',import.meta.url),
 JSON.stringify(output,null,2)+'\n');
console.log('DUNGEON_BASELINE_REVIEW '+JSON.stringify({version:output.schemaVersion,
 status:output.status,changes:output.changeCount,bands:bands.length}));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Economic median revision: review only, NOT activated\n'+
 'Economy seed '+output.economySeed+'; '+output.economySamples+' seeded accounts/route; '+
 output.changeCount+'/'+bands.length+' band entries differ from unchanged frozen v1.\n'+
 'Proposed owner loadouts, actual HP/MP and carried items are in reports/dungeon-baseline-review-proposal-v3.json.\n');
