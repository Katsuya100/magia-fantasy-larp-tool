import assert from 'node:assert/strict';
import {createBattleInputBuffer,canReplayBufferedBattleCommand}
 from '../assets/js/dungeon-battle-input.mjs';

// Exact pre-fix implementation from main commit 7371f5402dd5695362dfec550fc9e53477e5ce34.
// Keep the old implementation executable so this test demonstrably reproduces
// the click loss before it verifies the corrected behavior.
const baselineSource="// Only the final combat phase admits one buffered follow-up command.\n// No fixed delay runs from the start of the turn.\nexport const LAST_PHASE_OVERLAP_RATIO=0.7;\nexport function createBattleInputBuffer({\n setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)\n}={}){\n let open=false,ready=false,pending=null,wake=null,timer=null;\n return {\n  begin(duration){\n   if(timer!==null)clearTimer(timer);\n   open=true;ready=duration<=0;\n   const signal=new Promise(resolve=>{wake=resolve;});\n   if(!ready)timer=setTimer(()=>{\n    timer=null;ready=true;\n    if(pending!==null)wake?.();\n   },Math.ceil(duration*LAST_PHASE_OVERLAP_RATIO));\n   return signal;\n  },\n  offer(command){\n   if(!open||pending!==null)return false;\n   pending=command;\n   if(ready)wake?.();\n   return true;\n  },\n  close(){\n   open=false;ready=false;wake=null;\n   if(timer!==null){clearTimer(timer);timer=null;}\n  },\n  take(){const command=pending;pending=null;return command;}\n };\n}\n";
const baseline=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(baselineSource));

const newTimers=[],oldTimers=[];
const harness=timers=>({
 setTimer:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},
 clearTimer:()=>{}
});
const oldInput=baseline.createBattleInputBuffer(harness(oldTimers));
const liveInput=createBattleInputBuffer(harness(newTimers));
const firstPhaseTap={kind:'cast',index:1,floor:49};
const oldFirstPhaseAccepted=oldInput.offer(firstPhaseTap);
assert.equal(oldFirstPhaseAccepted,false,
 'REPRO before fix: clicking on a visible spell during the first combat phase is silently discarded');
assert.equal(oldInput.take(),null,
 'REPRO before fix: there is no queued turn after the discarded click');

// Fixed behavior: admit only one click from the start of battle FX.
liveInput.start();
assert.equal(liveInput.offer(firstPhaseTap),true,
 'FIX: the same first-phase click is retained');
assert.equal(liveInput.offer({kind:'cast',index:2,floor:49}),false,
 'FIX: a double tap cannot queue two extra turns');
const ready=liveInput.begin(440);
assert.equal(newTimers[0].ms,308,'replay still waits until 70% of the last phase');
newTimers[0].fn();
await ready;
liveInput.close();
assert.deepEqual(liveInput.take(),firstPhaseTap);

// Changing the profile while a spell is queued must reject stale commands,
// even if the restored save happens to be on the identical floor.
const beforeRun={stage:'battle',floor:49,hero:{hp:1},enemy:{hp:1}};
const queued={kind:'cast',index:1,floor:49,run:beforeRun};
assert.equal(canReplayBufferedBattleCommand(queued,beforeRun),true);
assert.equal(canReplayBufferedBattleCommand(queued,{...beforeRun}),false,
 'restored save uses a different run object and must not inherit its input');
beforeRun.stage='checkpoint';
assert.equal(canReplayBufferedBattleCommand(queued,beforeRun),false,
 'no cast can be replayed after a boss victory');
console.log('PASS reproduced pre-fix early-click loss on original module; new battle buffer retains exactly one safe input');
