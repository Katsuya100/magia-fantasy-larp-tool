import assert from 'node:assert/strict';
import {playCombatSequence,fatalSide,simultaneousPhases} from '../assets/js/dungeon-combat-fx.mjs';
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
const playback=playCombatSequence(staged,phase=>painted.push(phase[0].role),{
 duration:440,
 wait:ms=>new Promise(resolve=>{waits.push({ms,resolve});}),
 onLastPhase:(phase,duration)=>{
  assert.deepEqual(painted,['support','defense','debuff','attack'],'final phase gate begins after all earlier roles');
  assert.equal(phase[0].role,'attack');
  assert.equal(duration,440);
  return queued;
 }
});
for(const role of ['support','defense','debuff']){
 assert.equal(painted.at(-1),role);
 const current=waits.at(-1);
 assert.equal(current.ms,440);
 current.resolve();
 await new Promise(resolve=>setImmediate(resolve));
}
assert.equal(painted.at(-1),'attack');
assert.equal(waits.length,4,'last phase still starts a complete 440ms wait');
acceptNext(); // as if the final phase reached 70% with a buffered command
await playback;
assert.equal(waits[3].ms,440,'early release does not change the original effect duration');
waits[3].resolve();
let fatalWindow=0;
await playCombatSequence([step('attack','hero',60,0)],()=>{},{
 duration:0,onLastPhase:()=>{fatalWindow++;},onFatal:()=>{}
});
assert.equal(fatalWindow,0,'death never opens the follow-up window');

// The previous FX receives an independent DOM layer before new FX resets it.
const originalDocument=globalThis.document;
const copies=[],removedIds=[];
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
const flight={cloneNode:()=>element()};
const arena={
 appended:null,
 append(node){this.appended=node;},
 querySelector(selector){
  if(selector==='.spell-flight')return flight;
  return actors.get(selector.slice(1))||null;
 }
};
globalThis.document={createElement:()=>element()};
try{
 assert.equal(captureCombatFxEcho(arena,0),null,'reduced motion creates no tail');
 const echo=captureCombatFxEcho(arena,720);
 assert.ok(echo,'the visual-only echo is retained');
 assert.equal(arena.appended.dataset.active,'false','the old FX is initially hidden to avoid double brightness');
 assert.equal(copies.length,2,'both fighter FX keep their previous independent visuals');
 assert.ok(copies.every(x=>!x.children.some(child=>child.className==='unit-info')),'no stateful HP panels duplicated');
 assert.ok(removedIds.includes('id'),'cloned animation parts never duplicate live element IDs');
 echo.reveal();
 assert.equal(arena.appended.dataset.active,'true','old FX remains shown while new FX can start');
 echo.dispose();
 assert.equal(arena.appended.removed,true);
}finally{globalThis.document=originalDocument;}

console.log('PASS synchronized fatal FX, final-phase 70% input overlap, nonblocking affinity and retained visual tails');
