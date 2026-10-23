// Enforce that a manually reviewed baseline stays frozen. Re-running the
// economic simulator may propose a NEW candidate but never edits this file.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const reference=read('config/dungeon-economy-baseline-candidate.v1.json');
const measurements=read('reports/dungeon-journeys-v1.json');
const issues=[];
const levels={};
assert.equal(reference.schemaVersion,'dungeon-median-first-entry-candidate-v1');
assert.equal(reference.source.seed,measurements.seed,'measurement seed must match');
assert.equal(reference.source.economyTrials,measurements.samples,'economy trial count must match');
for(const route of ['short','long']){
 const source=measurements.combinations.find(x=>x.style==='A'&&x.route===route);
 assert.ok(source,'missing A economic route '+route);
 levels[route]=[];
 for(let i=0;i<10;i++){
  const row=source.checkpoints[i],candidate=reference.routes[route][i],observed=row.firstEntry;
  assert.ok(observed.count>0,'No real first-entry state for '+route+' F'+candidate.from);
  const current={from:candidate.from,to:candidate.to,
   level:Math.round(observed.level.median),
   upgradeLevels:observed.upgrades.map(x=>Math.round(x.median))};
  levels[route].push(current);
  if(candidate.from!==current.from||candidate.to!==current.to||
    candidate.level!==current.level||
    candidate.upgradeLevels.some((v,j)=>v!==current.upgradeLevels[j]))
    issues.push({route,...current,frozenLevel:candidate.level,
     frozenUpgrades:candidate.upgradeLevels});
 }
}
const report={schemaVersion:'dungeon-baseline-diff-v1',seed:measurements.seed,
 frozen:reference.schemaVersion,sourceRun:reference.source.actionRun,changes:issues,
 status:issues.length?'REVIEW_REQUIRED':'NO_DRIFT',
 requiredAction:issues.length?'Obtain user approval for a versioned baseline revision, never auto rewrite.':'none',
 observations:levels};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-baseline-diff-v1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('DUNGEON_BASELINE_DIFF '+JSON.stringify({status:report.status,count:issues.length,changes:issues.slice(0,8)}));
if(issues.length)process.exitCode=1;
