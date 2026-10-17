import assert from 'node:assert/strict';
import {playCombatSequence,fatalSide,simultaneousPhases} from '../assets/js/dungeon-combat-fx.mjs';
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
console.log('PASS synchronized duels with fatal death animation overlapping the final attack');
