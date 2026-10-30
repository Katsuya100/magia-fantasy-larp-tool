// Historical first-entry comparison only (not the acceptance gate).
// Approved observed win/MP targets are immutable inputs; measured economic
// loadouts are pinned in a separate unapproved candidate and may not auto-change.
// Run on GitHub Actions only. A missing real carry loadout is a HARD blocker,
// never repaired by granting hypothetical cleanse items.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {rng,spread} from './simulate-dungeon-journeys.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const goals=read('config/dungeon-approved-goals.v1.json');
const frozen=read('config/dungeon-economy-baseline-candidate.v1.json');
assert.equal(goals.strictSamples,256,'approved 256 combat samples');
assert.equal(goals.bands.length,10);
assert.equal(frozen.status,'CANDIDATE_NOT_USER_APPROVED');
const enemyChoice=(enemy,r)=>G.chooseEnemySpell(enemy,r);
const heroChoice=(hero,enemy,layer)=>{
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=layer>10?ids.find(i=>hero.spells[i].role==='support'):undefined;
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offense=ids.filter(i=>hero.spells[i].role==='attack');
 if(offense.length)return offense.sort((a,b)=>{
  const power=i=>G.effectivePower(hero,hero.spells[i])*G.resist(enemy,hero.spells[i].attribute);
  return power(b)-power(a)||a-b;
 })[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
};
function tryCleanse(hero,carry,layer,used){
 if(layer<51)return;
 const status=hero.statuses.find(x=>x.kind==='debuff');
 if(!status)return;
 let at=carry.findIndex(item=>item&&item.id==='clear_'+status.attribute&&G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(at<0&&layer>=71)at=carry.findIndex(item=>item&&item.id==='luna_stone'&&G.canUseBattleItem(hero,item,data.items,data.buffs));
 if(at<0)return;
 const item=carry[at];G.potion(hero,item,data.items,data.buffs);
 used[item.id]=(used[item.id]||0)+1;carry[at]=null;
}
function combat(seed,band,baseline){
 const random=rng(seed),encounterForFight=createSortieEncounterSelector(data.enemies,random),spellList=frozen.powers.map((power,i)=>({
  role:frozen.roles[i],attribute:frozen.attributes[i],power:strengthenedPower(power,baseline.upgradeLevels[i]),
  basePower:power,upgradeLevel:baseline.upgradeLevels[i]}));
 const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},baseline.level,{},spellList,'player');
 const carry=(baseline.verifiedCarry||[]).map(item=>({...item}));
 const result={win:false,cleared:band.from-1,entered:band.from,healCasts:0,enemyHealCasts:0,
  casts:0,mpEnd:0,hpEnd:0,exitRankEligible:false,rankChecks:0,
  usedItems:{},lossLayer:null,initialItems:carry.length,bossPreRecovery:null};
 for(let layer=band.from;layer<=band.to;layer++){
  for(let slot=1;slot<=5;slot++){
   const fight=(layer-1)*5+slot,enemy=G.fromEnemy(
    encounterForFight(fight),Number(data.floors[fight-1].enemy_level));
   let won=false;
   for(let turn=0;turn<80;turn++){
    tryCleanse(hero,carry,layer,result.usedItems);
    const ours=heroChoice(hero,enemy,layer),theirs=enemyChoice(enemy,random);
    if(ours>=0&&hero.spells[ours].role==='support')result.healCasts++;
    if(theirs>=0&&enemy.spells[theirs].role==='support')result.enemyHealCasts++;
    if(layer<=10&&((ours>=0&&hero.spells[ours].role==='support')||
        (theirs>=0&&enemy.spells[theirs].role==='support')))throw Error('1-10F combat healing forbidden');
    G.round(hero,enemy,ours,theirs,data.buffs,random);
    result.casts++;if(hero.hp<=0)break;
    if(enemy.hp<=0){won=true;break;}
   }
   if(!won){result.lossLayer=layer;return result;}
   if(slot===5&&layer%10===0){
    result.rankChecks++;
    result.bossPreRecovery={hp:100*hero.hp/hero.stats.hp,mp:100*hero.mp/hero.maxMp};
    result.exitRankEligible=Boolean(rankBadgeDrop(fight,hero,{adventurerRank:0}));
   }
   hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
   G.recoverVictoryMp(hero,layer);
  }
  result.cleared=layer;
  if(layer%10===0&&layer<band.to){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;}
 }
 result.win=true;result.mpEnd=100*hero.mp/hero.maxMp;result.hpEnd=100*hero.hp/hero.stats.hp;
 return result;
}
const report={schemaVersion:'economic-combat-benchmark-v1',baseline:frozen.schemaVersion,
 baselineApproval:frozen.status,samples:256,seedRule:'17011 + 13 * index',
 important:'A candidate benchmark does not certify a prepared state. Missing owned items are not simulated or granted.',
 routes:[],structuralErrors:[],mandatoryFailures:[],diagnosticWarnings:[]};
for(const route of ['short','long']){
 const tested=[];
 for(const [index,goalsBand] of goals.bands.entries()){
  const candidate=frozen.routes[route][index];
  if(candidate.from!==goalsBand.from||candidate.to!==goalsBand.to)
   throw Error('FROZEN band mismatch');
  const results=Array.from({length:256},(_,i)=>combat(17011+13*i,goalsBand,candidate));
  const wins=results.filter(x=>x.win),winRate=100*wins.length/256;
  const mp=spread(wins.map(x=>x.mpEnd)),hp=spread(wins.map(x=>x.hpEnd));
  const issues=[];
  if(!(winRate>=goalsBand.winRate[0]&&winRate<=goalsBand.winRate[1]))
   issues.push('Observed win rate outside approved limits');
  if(!(winRate>=goalsBand.winSafety[0]&&winRate<=goalsBand.winSafety[1]))
   issues.push('Observed win rate outside approved interior safety band');
  if(mp.median===null||mp.median<goalsBand.winnerMedianMp[0]||mp.median>goalsBand.winnerMedianMp[1])
   issues.push('Winner median MP outside approved limits');
  const availableCleanser=Array.isArray(candidate.verifiedCarry);
  if(goalsBand.from>=51&&!availableCleanser)
   issues.push('No verified economic supply of pre-stocked specific/all-state cleansers');
  if(goalsBand.from>=51&&availableCleanser&&
    candidate.verifiedCarry.some(item=>{
     const row=data.items.find(x=>x.id===item.id);
     return !row||!['clear','clear_all'].includes(row.kind);
    }))throw Error('Only legal status recovery consumables permitted');
  if(!availableCleanser)report.diagnosticWarnings.push({route,band:goalsBand.from+'-'+goalsBand.to,
   reason:'missing locked carry inventory; item-free observed combat is a diagnostic lower bound'});
  const row={route,band:goalsBand.from+'-'+goalsBand.to,level:candidate.level,
   upgrades:candidate.upgradeLevels,samples:256,winRate,mp,hp,wins:wins.length,
   firstFailedLayers:Object.entries(results.filter(x=>!x.win).reduce((a,x)=>
    (a[x.lossLayer]=(a[x.lossLayer]||0)+1,a),{})),
   rankEligibilityAmongWins:wins.length?wins.filter(x=>x.exitRankEligible).length/wins.length*100:null,
   bossPreRecoveryHp:spread(wins.filter(x=>x.bossPreRecovery).map(x=>x.bossPreRecovery.hp)),
   bossPreRecoveryMp:spread(wins.filter(x=>x.bossPreRecovery).map(x=>x.bossPreRecovery.mp)),
   heals:spread(results.map(x=>x.healCasts)),itemsUsed:results.map(x=>Object.values(x.usedItems)
    .reduce((a,b)=>a+b,0)).reduce((a,b)=>a+b,0),issues,passed:issues.length===0};
  tested.push(row);
  if(issues.length)report.mandatoryFailures.push({route,band:row.band,issues});
  console.log('DUNGEON_ECONOMIC_COMBAT '+JSON.stringify(row));
 }
 report.routes.push({route,bands:tested});
}
if(frozen.status!=='USER_APPROVED')
 report.mandatoryFailures.push({reason:'Frozen economic source state is a candidate awaiting approval; cannot certify release'});
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-economic-combat-v1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const headline='Economy-derived candidate strict 256-seed combat: '+report.mandatoryFailures.length+' mandatory blockers';
console.log('DUNGEON_ECONOMIC_COMBAT_SUMMARY '+JSON.stringify({status:report.mandatoryFailures.length?'NEEDS_TUNING':'PASS',
 source:frozen.schemaVersion,failures:report.mandatoryFailures.length}));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## '+headline+'\n'+report.routes.map(r=>'**'+r.route+'**: '+
 r.bands.map(b=>b.band+' '+b.winRate.toFixed(1)+'% win / '+(b.mp.median===null?'—':b.mp.median.toFixed(1))+'% MP').join(', ')).join('\n\n')+'\n');
if(report.mandatoryFailures.length&&process.env.DUNGEON_ECONOMIC_COMBAT_DIAGNOSTIC!=='1')
 process.exitCode=1;
