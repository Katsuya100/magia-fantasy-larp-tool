// Forecast only: assumes every fight is won, every boss return succeeds,
// and every 10-layer rank is awarded (>=80% HP/MP). No combat RNG is modeled.
// All XP and stone chances are calculated by the real game functions/CSV.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {allowedStartLayer} from '../assets/js/dungeon-ranks.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});

export const MAGIC_STONES_PER_ULTIMATE=150;
export const EQUIPPED_CIRCLES=5;
export const ALL_ULTIMATE_COST=MAGIC_STONES_PER_ULTIMATE*EQUIPPED_CIRCLES;
export const SAMPLES_DEFAULT=512;

export function seededRandom(seed){
 if(!Number.isSafeInteger(seed))throw Error('Seed must be an integer');
 let state=seed>>>0;
 return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}

function fightRewards(layer,playerLevel,random,firstClear=false){
 // Exactly five encounters per layer. The existing dropCounts function reads
 // the actual stone chance, including the repeat-clear over-level reduction.
 const enemyLevel=targetClearLevel(layer);
 let stone=0,xp=0;
 for(let fight=0;fight<5;fight++){
  stone+=G.dropCounts(enemyLevel,random,{playerLevel,layer,firstClear}).stone;
  xp+=G.fightExperience(enemyLevel,playerLevel,layer);
 }
 return {stone,xp};
}

function progressTo100(random){
 const profile={level:1,xp:0,adventurerRank:0};
 let stones=0,fights=0,layerClears=0,repeatedLayerClears=0,underleveledStarts=0;
 const milestones=[];
 // Always return immediately after beating the next new layer's boss to bank
 // XP. Starting floors are limited to 1, 11, ... by acquired rank.
 for(let destination=1;destination<=100;destination++){
  const start=allowedStartLayer(profile,profile.adventurerRank+1);
  const expeditionLevel=profile.level;
  if(expeditionLevel<targetClearLevel(destination))underleveledStarts++;
  let pendingXp=0,pendingStones=0;
  for(let layer=start;layer<=destination;layer++){
   const reward=fightRewards(layer,expeditionLevel,random,layer===destination);
   pendingXp+=reward.xp;
   pendingStones+=reward.stone;
   layerClears++;
   fights+=5;
   if(layer<destination)repeatedLayerClears++;
  }
  // The game only banks rewards and levels up on return, not mid-expedition.
  stones+=pendingStones;
  G.experience(profile,pendingXp);
  // Optimistic rank condition: enough HP/MP remains after every 10th boss.
  if(destination%10===0)profile.adventurerRank=destination;
  if(destination%10===0){
   milestones.push({layer:destination,start,level:profile.level,stones,
    layerClears,fights,returns:destination});
  }
 }
 return {level:profile.level,rank:profile.adventurerRank,returns:100,
  fights,layerClears,repeatedLayerClears,underleveledStarts,stones,milestones,
  evenFiveLevels:Array.from({length:EQUIPPED_CIRCLES},(_,i)=>
   Math.floor(stones/EQUIPPED_CIRCLES)+(i<stones%EQUIPPED_CIRCLES?1:0)),
  possibleUltimateCircles:Math.min(EQUIPPED_CIRCLES,Math.floor(stones/MAGIC_STONES_PER_ULTIMATE))};
}

export function simulateProgression(seed=20261019){
 return progressTo100(seededRandom(seed));
}

export function simulateAllUltimate(seed=20261019,{farming='endless'}={}){
 if(!['endless','revisit'].includes(farming))throw Error('Unknown farm route');
 const random=seededRandom(seed);
 const progression=progressTo100(random);
 if(progression.level!==150||progression.rank!==100)throw Error('100-layer baseline did not reach level 150 and rank 100');
 // After rank 100, 101F is a legal start; enemies exceed Lv150 while the player stays capped.
 // Alternate route: replay unlocked 91-100F as one ten-layer expedition.
 const from=farming==='endless'?101:91,to=farming==='endless'?101:100;
 let totalStones=progression.stones,farmStones=0,farmSorties=0,farmFights=0;
 while(totalStones<ALL_ULTIMATE_COST){
  if(++farmSorties>5000)throw Error('Stone farm did not converge');
  let pending=0;
  for(let layer=from;layer<=to;layer++)pending+=fightRewards(layer,150,random).stone;
  totalStones+=pending;
  farmStones+=pending;
  farmFights+=5*(to-from+1);
 }
 return {farming,progression,farmStartLayer:from,farmEndLayer:to,
  farmSorties,farmFights,farmStones,totalStones,
  spent:ALL_ULTIMATE_COST,remaining:totalStones-ALL_ULTIMATE_COST,
  totalSorties:progression.returns+farmSorties,
  totalFights:progression.fights+farmFights};
}

const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
function distribution(values){
 const sorted=[...values].sort((a,b)=>a-b);
 return {mean:Math.round(average(values)*10)/10,
  p10:sorted[Math.floor((sorted.length-1)*.10)],
  median:sorted[Math.floor((sorted.length-1)*.5)],
  p90:sorted[Math.floor((sorted.length-1)*.90)]};
}
export function summarizeStoneEconomy(samples=SAMPLES_DEFAULT,seed=20261019){
 if(!Number.isSafeInteger(samples)||samples<1||samples>10000)throw Error('Samples must be 1-10000');
 const campaigns=Array.from({length:samples},(_,i)=>simulateAllUltimate(seed+i*7919));
 const revisits=Array.from({length:samples},(_,i)=>simulateAllUltimate(seed+i*7919,{farming:'revisit'}));
 return {samples,seed,assumptions:{
  success:'Every battle won; rank awarded at each 10th boss (>=80% HP and MP)',
  returns:'Return after each new layer to bank XP; start at latest rank checkpoint',
  farming:'After 100F, replay 101F or 91-100F at Lv150; return every farm sortie',
  expenditure:'Every earned stone can be invested into five circles at one stone per upgrade',
  notModeled:'Combat failures, items, death, time, and player decisions'
 },progression:{
  returns:campaigns[0].progression.returns,
  layerClears:campaigns[0].progression.layerClears,
  repeatedLayerClears:campaigns[0].progression.repeatedLayerClears,
  fights:campaigns[0].progression.fights,
  level:campaigns[0].progression.level,
  underleveledStarts:campaigns[0].progression.underleveledStarts,
  earnedStones:distribution(campaigns.map(x=>x.progression.stones)),
  possibleUltimateCircles:distribution(campaigns.map(x=>x.progression.possibleUltimateCircles)),
  evenLevelsPerCircle:distribution(campaigns.map(x=>x.progression.evenFiveLevels[0])),
  milestones:campaigns[0].progression.milestones
 },allFiveUltimate:{
  cost:ALL_ULTIMATE_COST,
  remainingNeededAt100:distribution(campaigns.map(x=>Math.max(0,ALL_ULTIMATE_COST-x.progression.stones))),
  farm101:{sorties:distribution(campaigns.map(x=>x.farmSorties)),
   fights:distribution(campaigns.map(x=>x.farmFights))},
  farm91to100:{sorties:distribution(revisits.map(x=>x.farmSorties)),
   fights:distribution(revisits.map(x=>x.farmFights))}
 }};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const count=process.argv[2]===undefined?SAMPLES_DEFAULT:Number(process.argv[2]);
 console.log('DUNGEON_STONE_ECONOMY '+JSON.stringify(summarizeStoneEconomy(count)));
}
