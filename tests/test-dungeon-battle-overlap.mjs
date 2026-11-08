import assert from 'node:assert/strict';
import {playCombatSequence,fatalSide,simultaneousPhases,ENEMY_FINISH_HIT_STOP_MS} from '../assets/js/dungeon-combat-fx.mjs';
import {LAST_PHASE_OVERLAP_RATIO,createBattleInputBuffer,canReplayBufferedBattleCommand} from '../assets/js/dungeon-battle-input.mjs';
import {captureCombatFxEcho} from '../assets/js/dungeon-combat-fx-echo.mjs';
const step=(role,side,h=60,e=0)=>({role,side,hero:{hp:h},enemy:{hp:e}});
assert.equal(fatalSide([step('attack','hero')]),'enemy');
assert.equal(fatalSide([step('attack','hero',0,0)]),'hero','defeat takes priority on mutual knockout');
const same=simultaneousPhases([step('attack','hero'),step('attack','enemy')]);
assert.equal(same.length,1);
const order=[];
await playCombatSequence(same.flat(),p=>order.push('attack-'+p.length),{
 duration:780,overlap:260,
 wait:async ms=>order.push('wait-'+ms),
 onFatal:async side=>order.push('death-'+side)
});
assert.deepEqual(order,['attack-2','wait-520','death-enemy','wait-260'],'fatal ceremony begins while attacks are finishing');
assert.equal(ENEMY_FINISH_HIT_STOP_MS,110,'finishing blow gets a short but visible 110ms pause');
const finisher=[];
await playCombatSequence([step('attack','hero',60,0)],()=>finisher.push('paint'),{
 duration:440,overlap:125,hitStopMs:ENEMY_FINISH_HIT_STOP_MS,
 wait:async ms=>finisher.push('wait-'+ms),
 onHitStop:active=>finisher.push('freeze-'+active),
 onFatal:side=>finisher.push('death-'+side)
});
assert.deepEqual(finisher,[
 'paint','wait-220','freeze-true','wait-110','freeze-false',
 'wait-95','death-enemy','wait-125'
],'only lethal enemy contact pauses at the hit frame, then resumes before the death animation');
const heroDefeat=[];
await playCombatSequence([step('attack','enemy',0,60)],()=>heroDefeat.push('paint'),{
 duration:440,overlap:125,hitStopMs:ENEMY_FINISH_HIT_STOP_MS,
 wait:async ms=>heroDefeat.push('wait-'+ms),
 onHitStop:active=>heroDefeat.push('freeze-'+active),
 onFatal:side=>heroDefeat.push('death-'+side)
});
assert.deepEqual(heroDefeat,['paint','wait-315','death-hero','wait-125'],
 'hero defeat retains its existing timing without the enemy finisher effect');
const noMotion=[];
await playCombatSequence([step('attack','hero',60,0)],()=>noMotion.push('paint'),{
 duration:0,hitStopMs:ENEMY_FINISH_HIT_STOP_MS,
 wait:async ms=>noMotion.push('wait-'+ms),
 onHitStop:active=>noMotion.push('freeze-'+active),
 onFatal:side=>noMotion.push('death-'+side)
});
assert.deepEqual(noMotion,['paint','death-enemy'],'reduced-motion skips hit stop entirely');
const interruptedStop=[];
await assert.rejects(
 playCombatSequence([step('attack','hero',60,0)],()=>interruptedStop.push('paint'),{
  duration:440,overlap:125,hitStopMs:ENEMY_FINISH_HIT_STOP_MS,
  wait:async ms=>{if(ms===ENEMY_FINISH_HIT_STOP_MS)throw Error('hit stop interrupted');},
  onHitStop:active=>interruptedStop.push('freeze-'+active),
  onFatal:side=>interruptedStop.push('death-'+side)
 }),/hit stop interrupted/);
assert.deepEqual(interruptedStop,['paint','freeze-true','freeze-false'],
 'a failed wait still releases frozen animation state before propagating');
const neverHitStop=[];
await playCombatSequence([step('attack','hero',60,10)],()=>neverHitStop.push('paint'),{
 duration:440,hitStopMs:ENEMY_FINISH_HIT_STOP_MS,
 wait:async ms=>neverHitStop.push('wait-'+ms),
 onHitStop:active=>neverHitStop.push('freeze-'+active),
 onFatal:side=>neverHitStop.push('death-'+side)
});
assert.deepEqual(neverHitStop,['paint','wait-440'],'ordinary nonlethal hit keeps its original tempo');
const alive=step('defense','hero',30,30),seen=[];
await playCombatSequence([alive],()=>seen.push('defense'),{duration:0,onFatal:()=>seen.push('death')});
assert.deepEqual(seen,['defense']);
// The follow-up window belongs to the LAST priority phase, not turn start.
assert.equal(LAST_PHASE_OVERLAP_RATIO,.7);
const signals=[],timers=[];
const input=createBattleInputBuffer({
 setTimer:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},
 clearTimer:timer=>{timer.cancelled=true;}
});
assert.equal(input.offer({kind:'cast',index:0}),false,'before the last phase no input is accepted');
const ready=input.begin(440);
assert.equal(timers[0].ms,308,'next animation can start at 70% of the final 440ms FX');
const first={kind:'cast',index:1,floor:2};
assert.equal(input.offer(first),true,'the final phase admits the next choice immediately');
assert.equal(input.offer({kind:'cast',index:2}),false,'repeat taps do not queue additional turns');
let readyCount=0;ready.then(()=>readyCount++);
await Promise.resolve();
assert.equal(readyCount,0,'buffered input does not release before 70%');
timers[0].fn();
await ready;
assert.equal(readyCount,1,'the pending action can start at the 70% mark');
input.close();
assert.deepEqual(input.take(),first,'only the first buffered choice executes');
assert.equal(input.take(),null,'no duplicate action remains');
assert.equal(input.offer(first),false,'the window closes after playback');
const nextReady=input.begin(440);
assert.equal(timers[1].ms,308,'a new turn uses a new final-phase timer');
timers[1].fn();
assert.equal(input.offer({kind:'use',index:0,floor:2}),true,'input after 70% can still run');
await nextReady;
input.close();
assert.deepEqual(input.take(),{kind:'use',index:0,floor:2});
input.begin(440);
input.close();
assert.equal(timers[2].cancelled,true,'completed combat cancels the pending release timer');

// #12/#17: an early tap on an enabled card was silently lost while FX was busy.
const earlyTimers=[];
const earlyInput=createBattleInputBuffer({
 setTimer:(fn,ms)=>{const timer={fn,ms};earlyTimers.push(timer);return timer;},
 clearTimer:()=>{}
});
assert.equal(earlyInput.offer({kind:'cast',index:0,floor:49}),false,'no buffering before combat begins');
earlyInput.start();
const earlyTap={kind:'cast',index:1,floor:49};
assert.equal(earlyInput.offer(earlyTap),true,'one tap during the FIRST combat phase is retained');
assert.equal(earlyInput.offer({kind:'cast',index:2,floor:49}),false,'extra taps do not stack turns');
const releaseEarly=earlyInput.begin(440);
assert.equal(earlyTimers[0].ms,308,'early tap still waits for the last-phase 70% boundary');
let earlyReleased=false;
releaseEarly.then(()=>{earlyReleased=true;});
await Promise.resolve();
assert.equal(earlyReleased,false,'early tap must never accelerate a combat turn');
earlyTimers[0].fn();
await releaseEarly;
earlyInput.close();
assert.deepEqual(earlyInput.take(),earlyTap,'the earlier input survives until the round completes');
earlyInput.start();
assert.equal(earlyInput.take(),null,'the next battle does not inherit stale input');
earlyInput.close();

// A save restored at the same depth is a different combat and must reject stale taps.
const liveRun={stage:'battle',floor:49,hero:{hp:10},enemy:{hp:10}};
const queuedForLive={run:liveRun,floor:49,kind:'cast',index:0};
assert.equal(canReplayBufferedBattleCommand(queuedForLive,liveRun),true);
assert.equal(canReplayBufferedBattleCommand(queuedForLive,{...liveRun}),false,
 'same floor is insufficient to authorize a click from an earlier Drive save');
assert.equal(canReplayBufferedBattleCommand(queuedForLive,{...liveRun,stage:'checkpoint'}),false);
liveRun.floor=50;
assert.equal(canReplayBufferedBattleCommand(queuedForLive,liveRun),false,
 'a buffered command cannot cross the encounter boundary');
liveRun.floor=49;liveRun.enemy.hp=0;
assert.equal(canReplayBufferedBattleCommand(queuedForLive,liveRun),false,
 'a defeated foe cannot consume a buffered cast');

// The playback callback opens only after all preceding roles/phases are painted.
const staged=[step('support','hero',60,30),step('defense','enemy',60,30),step('debuff','hero',60,30),step('attack','enemy',60,30)];
const painted=[],waits=[];
let acceptNext;
const queued=new Promise(resolve=>{acceptNext=resolve;});
const playback=playCombatSequence(staged,phase=>painted.push(phase.map(s=>s.role).join('+')),{
 duration:440,
 wait:ms=>new Promise(resolve=>{waits.push({ms,resolve});}),
 onLastPhase:(phase,duration)=>{
  assert.deepEqual(painted,['support+defense','debuff+attack'],
   'queued action is gated until the grouped offensive FX begins');
  assert.deepEqual(phase.map(s=>s.role),['debuff','attack']);
  assert.equal(duration,440);
  return queued;
 }
});
assert.equal(painted.at(-1),'support+defense');
assert.equal(waits[0].ms,440);
waits[0].resolve();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(painted.at(-1),'debuff+attack');
assert.equal(waits.length,2,'the round has two shared visual phases');
acceptNext(); // as if the final phase reached 70% with a buffered command
await playback;
assert.equal(waits[1].ms,440,'early release does not change the original effect duration');
waits[1].resolve();
let fatalWindow=0;
await playCombatSequence([step('attack','hero',60,0)],()=>{},{
 duration:0,onLastPhase:()=>{fatalWindow++;},onFatal:()=>{}
});
assert.equal(fatalWindow,0,'death never opens the follow-up window');

// The previous FX receives an independent DOM layer before new FX resets it.
const originalDocument=globalThis.document;
const copies=[],captionCopies=[],removedIds=[];
const element=()=>({
 dataset:{},style:{},children:[],setAttribute(){},remove(){this.removed=true;},
 removeAttribute(name){removedIds.push(name);},
 append(child){this.children.push(child);},
 querySelectorAll(){return [{removeAttribute(name){removedIds.push(name);}}];}
});
const actors=new Map(['enemyCombatant','heroCombatant'].map(id=>[id,{
 offsetLeft:id==='enemyCombatant'?0:180,offsetTop:4,offsetWidth:152,offsetHeight:200,
 cloneNode(){const copy=element();copies.push(copy);return copy;},
 querySelector(){return {cloneNode:()=>element()};}
}]));
const captions=new Map(['heroAffinityWord','enemyAffinityWord'].map((id,i)=>[id,{
 dataset:{affinity:i?'resist':'weak'},
 offsetLeft:i?180:0,offsetTop:0,offsetWidth:152,offsetHeight:200,
 cloneNode(){const copy=element();copy.className='affinity-caption';copy.dataset.affinity=this.dataset.affinity;captionCopies.push(copy);return copy;}
}]));
const flight={cloneNode:()=>element()};
const arena={
 appended:null,
 append(node){this.appended=node;},
 querySelector(selector){
  if(selector==='.spell-flight')return flight;
  return actors.get(selector.slice(1))||captions.get(selector.slice(1))||null;
 }
};
globalThis.document={createElement:()=>element()};
try{
 assert.equal(captureCombatFxEcho(arena,0),null,'reduced motion creates no tail');
 const echo=captureCombatFxEcho(arena,720);
 assert.ok(echo,'the visual-only echo is retained');
 assert.equal(arena.appended.dataset.active,'false','the old FX is initially hidden to avoid double brightness');
 assert.equal(copies.length,2,'both fighter FX keep their previous independent visuals');
 assert.equal(captionCopies.length,2,'RESIST and WEAK retain separate motionless word layers');
 assert.ok(captionCopies.every(x=>x.style.cssText?.includes('width:152px')),'word overlays keep their grid positions when echoed');
 assert.ok(arena.appended.children.some(x=>x.className==='affinity-caption'),'a stable word is copied without its shaking parent');
 assert.ok(copies.every(x=>!x.children.some(child=>child.className==='unit-info')),'no stateful HP panels duplicated');
 assert.ok(removedIds.includes('id'),'cloned animation parts never duplicate live element IDs');
 echo.reveal();
 assert.equal(arena.appended.dataset.active,'true','old FX remains shown while new FX can start');
 echo.dispose();
 assert.equal(arena.appended.removed,true);
 // Reproduce #15: an earlier WEAK layer can still be alive when a later
 // RESIST/attack phase kills the enemy. Disposing only the newest leaks WEAK.
 const earlier=captureCombatFxEcho(arena,720),earlierLayer=arena.appended;
 const newest=captureCombatFxEcho(arena,720),newestLayer=arena.appended;
 earlier.reveal();
 newest.reveal();
 assert.equal(earlierLayer.removed,undefined,'older effect would otherwise linger');
 for(const active of [earlier,newest])active.dispose();
 assert.equal(earlierLayer.removed,true,'fatal cleanup removes prior-phase WEAK');
 assert.equal(newestLayer.removed,true,'fatal cleanup removes last-phase RESIST');
}finally{globalThis.document=originalDocument;}

console.log('PASS synchronized fatal FX, final-phase 70% input overlap, nonblocking affinity and retained visual tails');
