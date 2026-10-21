// Exploratory in-memory HP sweep for neutral circle strict balance targets.
// Uses exact shipped combat simulations and identical benchmark seed policies.
// Invoked only by GitHub Actions; never changes game data or test thresholds.
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {simulate} from '../tests/test-dungeon-progression-simulation.mjs';
import {deepRun} from '../tests/test-dungeon-deep-cleanse-simulation.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const enemies=csv('enemies'),data={enemies,balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const LEVELS={10:19,20:37,30:55,40:72,50:87,60:102,70:115,80:128,90:139,100:150};
const SEEDS=128;
const seed=i=>17011+i*13;
const milestones=Array.from({length:SEEDS},(_,i)=>simulateProgression(seed(i)+81).milestones);
const factorRange=process.env.FACTORS?process.env.FACTORS.split(',').map(Number):
 Array.from({length:35},(_,i)=>Math.round((.55+i*.04)*100)/100);
const choices=process.env.BANDS?process.env.BANDS.split(',').map(Number):Array.from({length:10},(_,i)=>(i+1)*10);
const firstSamples=Number(process.env.TUNE_SAMPLES||32);
const med=xs=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),n=s.length;return (s[Math.floor((n-1)/2)]+s[Math.floor(n/2)])/2;};
const percent=x=>x===null?null:Math.round(x*10)/10;
function assess(to,factor,samples){
 const from=to-9,level=LEVELS[to],withItems=from>=51;
 const master=enemies.map((e,index)=>{
  if(index<(from-1)*5||index>=to*5)return e;
  return {...e,hp:String(Math.max(1,Math.round(Number(e.hp)*factor)))};
 });
 const rate=from<=10?.25:from<=20?.30:.75,runs=[];
 for(let i=0;i<samples;i++){
  const earned=from===1?0:milestones[i].find(x=>x.layer===from-1)?.stones;
  if(earned==null)throw Error('missing stones at '+from);
  const spending=Math.floor(earned*rate+1e-8),s=seed(i);
  const a=withItems?deepRun(s,{from,to,level},true,master):simulate(s,{level,fromLayer:from,toLayer:to,spells:from===1?'intro':'five',stones:spending,enemyMaster:master});
  runs.push({win:a.win,mp:withItems?a.mp/a.maxMp*100:a.mp/a.initialMp*100});
 }
 const winners=runs.filter(x=>x.win),winRate=100*winners.length/samples,medianMp=med(winners.map(x=>x.mp));
 const winLower=from<=20?99:90,winUpper=from<=20?100:97;
 const mpLower=from<=10?50:0,mpUpper=from<=10?100:15;
 const failWin=winRate<winLower?winLower-winRate:winRate>winUpper?winRate-winUpper:0;
 const failMp=medianMp===null?50:medianMp<mpLower?mpLower-medianMp:medianMp>mpUpper?medianMp-mpUpper:0;
 const score=failWin*3+failMp+(medianMp===null?50:0);
 return {to,factor,samples,winRate:percent(winRate),medianMp:percent(medianMp),failWin:percent(failWin),failMp:percent(failMp),score:percent(score),passed:score===0};
}
for(const to of choices){
 const entries=[];
 for(const factor of factorRange)entries.push(assess(to,factor,firstSamples));
 entries.sort((a,b)=>a.score-b.score||Math.abs(a.factor-1)-Math.abs(b.factor-1));
 console.log('TUNE_COARSE '+JSON.stringify({to,best:entries.slice(0,10)}));
 const refine=new Set();
 for(const candidate of entries.slice(0,6)){
  for(let d=-3;d<=3;d++)refine.add(Math.round((candidate.factor+d*.01)*1000)/1000);
 }
 let detailed=[...refine].filter(x=>x>0).sort((a,b)=>a-b).map(f=>assess(to,f,SEEDS));
 detailed.sort((a,b)=>a.score-b.score||Math.abs(a.factor-1)-Math.abs(b.factor-1));
 console.log('TUNE_FULL '+JSON.stringify({to,best:detailed.slice(0,12)}));
}
