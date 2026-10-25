// Controlled, paired deck comparison. The six journeys supply genuine banked
// upgrades/items; fixed-deck circles are a comparator, NEVER owner resources.
// Both arms have the same owner base, level, inventory, rank, tactics and seed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
import {upgradeSpells} from '../tests/test-dungeon-progression-simulation.mjs';
import {withNeutralAttackAttributes} from '../tests/helpers/dungeon-neutral-loadout.mjs';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const goals=load('config/dungeon-approved-goals.v1.json');
const economy=load('reports/dungeon-linked-256-economy-v1.json');
const banked=load('reports/dungeon-linked-256-reference-v1.json');
const enemyMaster=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
assert.equal(economy.samplesPerPolicy,goals.strictSamples);
assert.equal(banked.samplesPerPolicy,goals.strictSamples);
const INTRO=[['attack','flame',220],['attack','bolt',260],['attack','gravity',300],
 ['support','aqua',200],['defense','law',160]];
const NORMAL=[['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]];
const sourceSpells=goals.bands.map(b=>withNeutralAttackAttributes(
 (b.from===1?INTRO:NORMAL).map(([role,attribute,power])=>({role,attribute,power})),
 enemyMaster,b.from,b.to).spells);
const ledger=Array.from({length:goals.strictSamples},(_,i)=>
 simulateProgression(17011+i*13+81).milestones);
const referenceSpells=goals.bands.map((b,index)=>
 Array.from({length:goals.strictSamples},(_,i)=>{
  const prior=b.from-1;
  const stones=prior===0?0:ledger[i].find(row=>row.layer===prior)?.stones;
  assert.ok(Number.isFinite(stones),'fixed deck needs the original measured ledger');
  const rate=b.from<=10?.25:b.from<=20?.25+(b.from-10)*.05:.75;
  const invested=Math.floor(stones*rate+1e-8);
  return upgradeSpells(sourceSpells[index],invested).spells;
 }));
const percentile=(values,q)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.floor((sorted.length-1)*q)];
};
const score=(actual,fixed)=>{
 if(actual.won&&!fixed.won)return 'WIN_ADVANTAGE';
 if(!actual.won)return null;
 if(!fixed.won)return 'WIN_ADVANTAGE';
 const hp=actual.endHp-fixed.endHp,mp=actual.endMp-fixed.endMp;
 const rounds=fixed.casts-actual.casts;
 // Stable, materially positive improvement in at least one measured axis.
 // Do not buy one advantage with a serious regression elsewhere.
 if(hp>.2&&mp>=-1&&rounds>=-3)return 'HP_ADVANTAGE';
 if(mp>.2&&hp>=-1&&rounds>=-3)return 'MP_ADVANTAGE';
 if(rounds>0&&hp>=-1&&mp>=-1)return 'ROUND_ADVANTAGE';
 return null;
};
const report={schemaVersion:'dungeon-paired-build-strength-v1',
 method:'Actual banked post-replay deck against exact fixed-deck stone ledger; same owner base, level, rank, carry, full legal sortie HP/MP, same short tactical AI and same combat seed',
 candidatePromoted:false,strictSamples:goals.strictSamples,cases:[]};
for(const p of economy.policies){
 const owners=banked.policies.find(x=>x.style===p.style&&x.route===p.route);
 assert.ok(owners&&owners.owners.length===goals.strictSamples);
 for(const [index,band] of goals.bands.entries()){
  let stronger=0,observed=0,missing=0,actualWins=0,fixedWins=0;
  const deltas=[],rounds=[],sourceLoops=[],samples=[],reasonCounts={};
  for(let i=0;i<goals.strictSamples;i++){
   const owner=owners.owners[i];
   assert.equal(owner.seed,17011+13*i,'paired banked owner seed');
   const original=owner.reference?.[index];
   const post=owner.farming?.[index]??[];
   // The newest genuinely banked available replay is used; never fabricate
   // a missing third replay or select only successful combat attempts.
   let candidate=null,loops=0;
   for(let k=post.length-1;k>=0;k--)if(post[k]){
    candidate=post[k];loops=k+1;break;
   }
   if(!original||!candidate){missing++;samples.push({seed:owner.seed,status:'NO_BANKED_REPLAY',loops});continue;}
   assert.ok(candidate.additionalBankedReplayFights>=50*loops,
    'every extra loop must actually be fought and banked');
   assert.equal(candidate.unbankedXp,0);
   assert.equal(candidate.unbankedStone,0);
   assert.equal(candidate.unbankedInk,0);
   assert.ok(candidate.level>=goals.targetLevelCheckpoints[String(band.to)]);
   // This is ONLY a paired battle fixture. No EXP, items or magic stones are
   // credited to either journey from these simulated comparison fights.
   const hero=G.makeUnit(candidate.playerBase,candidate.level,{},candidate.circles,'hero');
   const shared={...candidate,playerHp:hero.stats.hp,playerMp:hero.maxMp,
    maxHp:hero.stats.hp,maxMp:hero.maxMp,statuses:[],
    cooldowns:candidate.circles.map(()=>0)};
   const combatSeed=37011+13*i;
   const actual=challenge(shared,band.from,combatSeed,{route:'short'});
   const fixed=challenge({...shared,circles:referenceSpells[index][i]},band.from,
    combatSeed,{route:'short'});
   const advantage=score(actual,fixed);
   if(advantage){stronger++;reasonCounts[advantage]=(reasonCounts[advantage]||0)+1;}
   observed++;actualWins+=Number(actual.won);fixedWins+=Number(fixed.won);
   deltas.push(actual.endMp-fixed.endMp);
   rounds.push(fixed.casts-actual.casts);
   sourceLoops.push(loops);
   samples.push({seed:owner.seed,status:advantage||'NOT_STRONGER',
    loops,level:candidate.level,ownedStones:candidate.earned.stone,
    investedStones:candidate.spent.stone,earnedInk:candidate.earned.ink,
    spentInk:candidate.spent.ink,ownedItems:candidate.carry.length,
    actual:{won:actual.won,hp:actual.endHp,mp:actual.endMp,rounds:actual.casts,
     firstLoss:actual.firstLoss},
    fixed:{won:fixed.won,hp:fixed.endHp,mp:fixed.endMp,rounds:fixed.casts,
     firstLoss:fixed.firstLoss}});
  }
  const row={style:p.style,route:p.route,band:band.from+'-'+band.to,
   population:goals.strictSamples,observed,missing,stronger,
   actualWinRate:100*actualWins/goals.strictSamples,
   fixedPairedWinRate:100*fixedWins/goals.strictSamples,
   medianMpDelta:percentile(deltas,.5),
   medianRoundsSaved:percentile(rounds,.5),
   replayLoops:{median:percentile(sourceLoops,.5),p90:percentile(sourceLoops,.9)},
   improvementModes:reasonCounts,passed:stronger===goals.strictSamples,
   samples};
  report.cases.push(row);
  console.log('BUILD_STRENGTH '+JSON.stringify({...row,samples:undefined}));
 }
}
assert.equal(report.cases.length,60);
report.summary={bands:60,proven:report.cases.filter(x=>x.passed).length,
 insufficient:report.cases.filter(x=>!x.passed).length};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-paired-build-strength-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('BUILD_STRENGTH_SUMMARY '+JSON.stringify(report.summary));
