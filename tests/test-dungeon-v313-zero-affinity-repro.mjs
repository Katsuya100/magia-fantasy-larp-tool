import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';
import * as Echo from '../assets/js/dungeon-combat-fx-echo.mjs';

// 47-49F: old RESIST/WEAK effects keep their natural 720ms lifespan even
// when the next 70%-overlapped input becomes a MISS or a zero-damage attack.
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
assert.match(app,/lastEcho\?\.reveal\(\);\s*clearCombatEffects\(\)/,
 'the next combat phase reveals the previous animated tail unconditionally');
assert.doesNotMatch(app,/discardCombatEchoesOnMiss/,
 'no MISS-only cleanup can cut short a previous visual');
assert.equal(Echo.discardCombatEchoesOnMiss,undefined,
 'obsolete MISS-specific removal is not exported');
const oldDoc=globalThis.document,oldSetTimeout=globalThis.setTimeout,oldClearTimeout=globalThis.clearTimeout;
const timers=new Map(),nodes=[];
let timerId=0;
const element=()=>({
 dataset:{},style:{},children:[],
 setAttribute(){},removeAttribute(){},append(child){this.children.push(child);},
 remove(){this.removed=true;},querySelectorAll(){return [];}
});
const actor=id=>({
 dataset:{affinity:id==='enemyCombatant'?'resist':'none'},
 offsetLeft:0,offsetTop:0,offsetWidth:120,offsetHeight:180,
 cloneNode(){const copy=element();copy.dataset={...this.dataset};return copy;},
 querySelector(){return {cloneNode:()=>element()};}
});
const arena={
 append(node){nodes.push(node);},
 querySelectorAll(sel){return sel==='.combat-fx-echo'?nodes.filter(node=>!node.removed):[];},
 querySelector(sel){if(sel==='#heroCombatant')return actor('heroCombatant');
  if(sel==='#enemyCombatant')return actor('enemyCombatant');
  return null;}
};
try{
 globalThis.document={createElement:element};
 globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);

 const first=Echo.captureCombatFxEcho(arena,720);
 assert.ok(first,'an affinity hit creates a retained visual tail');
 const firstNode=nodes.at(-1),firstTimer=timers.get(timerId);
 assert.equal(firstTimer.ms,720,'the full affinity animation is scheduled');
 assert.equal(firstNode.children[0].dataset.affinity,'resist');

 const missed={side:'hero',role:'attack',attribute:'flame',amount:0,enemy:{resists:{flame:.8}}};
 assert.equal(attackHitAffinity(missed),'none',
  'the new missed attack never gains its own false RESIST');
 first.reveal(); // The next phase is a MISS, but the old tail still finishes.
 assert.equal(firstNode.dataset.active,'true');
 assert.equal(firstNode.removed,undefined,'MISS cannot remove the old effect');

 // A new turn can begin at 70% while the earlier effect is still alive.
 const previousTurn=Echo.captureCombatFxEcho(arena,720);
 const previousTurnNode=nodes.at(-1),previousTimer=timers.get(timerId);
 previousTurn.reveal();
 assert.equal(previousTurnNode.removed,undefined,'previous-turn tail also survives MISS');
 firstTimer.fn();
 assert.equal(firstNode.removed,true,'first effect is removed naturally at 100%');
 assert.equal(previousTurnNode.removed,undefined,'unrelated effect is not cancelled');
 previousTimer.fn();
 assert.equal(previousTurnNode.removed,true,'second effect finishes independently');

 // A terminal defeat/loot transition still discards all remaining animation.
 const lethalEcho=Echo.captureCombatFxEcho(arena,720);
 lethalEcho.reveal();
 const lethalNode=nodes.at(-1),currentEchoes=[];
 Echo.disposeCombatEchoes(arena,currentEchoes);
 assert.equal(lethalNode.removed,true,'terminal battle transition cleans up FX');
 assert.match(app,/onFatal:side=>\{[\s\S]*?disposeCombatEchoes\(\$\('battleArena'\),activeEchoes\)/,
  'fatal combat retains explicit cleanup');
}finally{
 globalThis.document=oldDoc;globalThis.setTimeout=oldSetTimeout;globalThis.clearTimeout=oldClearTimeout;
}
console.log('PASS overlapped combat FX survive MISS and zero hits until their natural expiry; fatal cleanup remains');
