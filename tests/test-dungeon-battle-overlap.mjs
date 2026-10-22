import assert from 'node:assert/strict';
import {playCombatSequence,fatalSide,simultaneousPhases} from '../assets/js/dungeon-combat-fx.mjs';
import {BATTLE_INPUT_LEAD_MS,createBattleInputBuffer} from '../assets/js/dungeon-battle-input.mjs';
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
// Follow-up input is buffered at exactly 250ms, with the original animation untouched.
let elapsed=0;
const buffer=createBattleInputBuffer(()=>elapsed);
assert.equal(BATTLE_INPUT_LEAD_MS,250);
assert.equal(buffer.offer({kind:'cast',index:0}),false,'no input before combat playback');
buffer.start();
elapsed=249;
assert.equal(buffer.offer({kind:'cast',index:0}),false,'249ms is too early');
elapsed=250;
const first={kind:'cast',index:1,floor:3};
assert.equal(buffer.offer(first),true,'250ms input is accepted during playback');
assert.equal(buffer.offer({kind:'use',index:2}),false,'rapid taps must not stack extra turns');
buffer.stop();
assert.equal(buffer.offer({kind:'cast',index:3}),false,'post-playback is not an open input buffer');
assert.deepEqual(buffer.take(),first,'pending choice survives animation completion');
assert.equal(buffer.take(),null,'the pending choice executes only once');
elapsed=300;
buffer.start();
elapsed=549;
assert.equal(buffer.offer({kind:'cast',index:0}),false,'each animation has its own 250ms gate');
elapsed=550;
assert.equal(buffer.offer({kind:'use',index:0}),true,'item input uses the same gate');
assert.deepEqual(buffer.take(),{kind:'use',index:0});

console.log('PASS synchronized duels with fatal death animation overlapping the final attack');
