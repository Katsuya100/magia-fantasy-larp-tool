// A review-only, reproducible proposal. NEVER write the active/frozen config,
// and NEVER evaluate strict combat against dynamically refreshed medians.
// The source economic measurements and seed are pinned in this output.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const measurement=read('reports/dungeon-journeys-v1.json');
const frozen=read('config/dungeon-economy-baseline-candidate.v1.json');
const bands=[];
const measured={missing:0,available:0};
const quantile=(xs,p)=>{
 if(!xs.length)return null;
 const sorted=[...xs].sort((a,b)=>a-b);
 const at=(sorted.length-1)*p,low=Math.floor(at),high=Math.ceil(at);
 return sorted[low]+(sorted[high]-sorted[low])*(at-low);
};
const distribution=xs=>({p10:quantile(xs,.1),median:quantile(xs,.5),p90:quantile(xs,.9)});
for(const route of ['short','long']){
 const cohort=measurement.combinations.find(x=>x.style==='A'&&x.route===route);
 if(!cohort?.comparisonStates)throw Error('Economy must contain real individual owner snapshots');
 for(let i=0;i<10;i++){
  const from=i*10+1,to=from+9,base=frozen.routes[route][i];
  // Prepared ownership is not first-entry ownership. Never invent levels,
  // five circles, HP/MP or banked inventory for a missing prepared account.
  const real=cohort.comparisonStates.map(x=>({seed:x.seed,state:x.preparedSnapshots?.[from]}))
   .filter(x=>x.state?.source==='POST_RETURN_BANKED_AND_INVESTED'&&
    Number.isSafeInteger(x.state.level)&&x.state.circles?.length===5);
  const existingFrozen={level:base.level,upgradeLevels:base.upgradeLevels};
  if(!real.length){
   measured.missing++;
   bands.push({route,from,to,accounts:0,status:'ECONOMY_NOT_READY',
    comparison:{existingFrozen,measuredMedianProposal:null,requiresReview:null},
    observedDistribution:null,indivisibleRealOwnerReference:null,
    issue:'No actual post-return banked, rank/level-ready owner for this band; no median proposed'});
   continue;
  }
  measured.available++;
  real.sort((a,b)=>a.state.level-b.state.level||a.seed-b.seed);
  const representative=real[Math.floor((real.length-1)/2)];
  const levels=real.map(x=>x.state.level);
  const upgradeLevels=[0,1,2,3,4].map(index=>
   Math.round(quantile(real.map(x=>x.state.circles[index].upgradeLevel),.5)));
  const proposed={from,to,level:Math.round(quantile(levels,.5)),upgradeLevels};
  const change=base.level!==proposed.level||
   base.upgradeLevels.some((x,j)=>x!==proposed.upgradeLevels[j]);
  const aggregate={
   level:distribution(levels),
   levelGap:distribution(real.map(x=>x.state.level-x.state.targetLevel)),
   bankStone:distribution(real.map(x=>x.state.bankedStones)),
   bankInk:distribution(real.map(x=>x.state.bankedInk)),
   power:[0,1,2,3,4].map(j=>distribution(real.map(x=>x.state.circles[j].power))),
   upgrade:[0,1,2,3,4].map(j=>distribution(real.map(x=>x.state.circles[j].upgradeLevel)))
  };
  bands.push({route,from,to,accounts:real.length,status:'MEASURED_PREPARED_REVIEW_ONLY',comparison:{
   existingFrozen,measuredMedianProposal:proposed,requiresReview:change},
   observedDistribution:aggregate,
   indivisibleRealOwnerReference:{seed:representative.seed,
    level:representative.state.level,rank:representative.state.rank,
    carry:representative.state.carry,
    playerHp:representative.state.playerHp,
    playerMp:representative.state.playerMp,
    maxHp:representative.state.maxHp,maxMp:representative.state.maxMp,
    spells:representative.state.circles,
    bankedStones:representative.state.bankedStones,
    bankedInk:representative.state.bankedInk,
    unbankedXp:representative.state.unbankedXp,
    actualFights:representative.state.actualFights,
    actualSorties:representative.state.actualSorties}});
 }
}
const output={schemaVersion:'dungeon-economic-baseline-review-proposal-v3',
 status:measured.missing?'ECONOMY_NOT_READY_REVIEW_ONLY_NOT_USER_APPROVED':'MEASURED_REVIEW_ONLY_NOT_USER_APPROVED',
 readyBandCount:measured.available,missingPreparedBandCount:measured.missing,
 currentFrozen:frozen.schemaVersion,source:measurement.schemaVersion,
 economySeed:measurement.seed,economySamples:measurement.samples,
 changeCount:bands.filter(b=>b.comparison.requiresReview===true).length,
 neitherBaselineNorSourceAutoupdated:true,
 notes:['These are only proposals; no consumer may treat this file as an accepted strict combat reference.',
  'Prepared-only per-field medians can describe no real player; each measured band includes a coherent actually-prepared owner reference.',
  'Long-route HP/MP and carried inventory are from actual entry; no full restoration on band changes.',
  'The existence of a proposed loadout does NOT mean it has passed readiness or combat targets.'],
 bands};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-baseline-review-proposal-v3.json',import.meta.url),
 JSON.stringify(output,null,2)+'\n');
console.log('DUNGEON_BASELINE_REVIEW '+JSON.stringify({version:output.schemaVersion,
 status:output.status,changes:output.changeCount,bands:bands.length,
 missingPreparedBands:output.missingPreparedBandCount}));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Economic median revision: review only, NOT activated\n'+
 'Economy seed '+output.economySeed+'; '+output.economySamples+' seeded accounts/route; '+
 output.changeCount+'/'+output.readyBandCount+' available prepared bands differ from unchanged frozen v1; '+
 output.missingPreparedBandCount+' ECONOMY_NOT_READY bands have no invented medians.\n'+
 'Proposed owner loadouts, actual HP/MP and carried items are in reports/dungeon-baseline-review-proposal-v3.json.\n');
