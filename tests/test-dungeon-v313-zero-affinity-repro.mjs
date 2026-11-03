import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';
import * as Echo from '../assets/js/dungeon-combat-fx-echo.mjs';

// #12b (47-49F): reproduce RESIST on screen while the NEW flame attack is 0.
// The earlier valid resisted hit leaves a 720ms visual echo. The next combat
// phase begins after 440ms, so blindly revealing that echo on a missed hit
// makes old RESIST text appear next to fresh -0 damage.
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const oldDoc=globalThis.document,oldSetTimeout=globalThis.setTimeout,oldClearTimeout=globalThis.clearTimeout;
const timers=new Map(),nodes=[];
let timerId=0;
const element=()=>({
 dataset:{},style:{},children:[],
 setAttribute(){},removeAttribute(){},append(child){this.children.push(child);},
 remove(){this.removed=true;},
 querySelectorAll(){return [];}
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
 const echo=Echo.captureCombatFxEcho(arena,720);
 assert.ok(echo,'an elemental resistance hit creates an echo');
 const oldResistNode=nodes.at(-1);
 assert.equal(oldResistNode.children[0].dataset.affinity,'resist',
  'the echo contains the earlier resisted hit (not the current one)');
 const missed={side:'hero',role:'attack',attribute:'flame',amount:0,enemy:{resists:{flame:.8}}};
 assert.equal(attackHitAffinity(missed),'none','a missed flame attack has no new RESIST');
 echo.reveal();
 assert.equal(oldResistNode.dataset.active,'true',
  'REPRO: blindly revealing old FX makes previous RESIST visible during a 0-damage attack');
 assert.match(app,/if\(discardCombatEchoesOnMiss\(phase,activeEchoes,\$\('battleArena'\)\)\)lastEcho=null/,
  'arena discards prior affinity echoes before showing a missed new attack');

 // Required behavior: a zero-hit phase discards the prior affinity echo,
 // but an ordinary hit must still retain its independent 720ms visual tail.
 assert.equal(typeof Echo.discardCombatEchoesOnMiss,'function',
  'reproduction gate: an attack miss needs explicit previous-echo disposal');
 // A previous turn can leave an orphaned ghost after the 70% early-input
 // overlap. Its handle is no longer in the new turn's activeEchoes array.
 const priorTurn=Echo.captureCombatFxEcho(arena,720);
 const priorTurnNode=nodes.at(-1);
 priorTurn.reveal();
 const echoes=[echo];
 assert.equal(Echo.discardCombatEchoesOnMiss([missed],echoes,arena),true);
 assert.equal(oldResistNode.removed,true,'prior RESIST is gone before the -0 phase paints');
 assert.equal(priorTurnNode.removed,true,
  'REPRO: even a prior-turn RESIST ghost outside this turn array must disappear on a 0 hit');
 assert.deepEqual(echoes,[]);
 const hit={...missed,amount:5};
 const kept=Echo.captureCombatFxEcho(arena,720);
 assert.equal(Echo.discardCombatEchoesOnMiss([hit],[kept],arena),false,
  'normal hits preserve their existing visual tail');
 kept.dispose();

 // At the next lethal attack, a ghost created by an earlier turn is not
 // present in activeEchoes; it still must be removed from the arena.
 const priorFatalEcho=Echo.captureCombatFxEcho(arena,720);
 priorFatalEcho.reveal();
 const priorFatalNode=nodes.at(-1);
 const thisTurnEchoes=[];
 Echo.disposeCombatEchoes(arena,thisTurnEchoes);
 assert.equal(priorFatalNode.removed,true,
  'REPRO: fatal transition cannot retain prior-turn RESIST in the arena');
 assert.match(app,/onFatal:side=>\{[\s\S]*?disposeCombatEchoes\(\$\('battleArena'\),activeEchoes\)/,
  'real fatal path calls the same cleanup as a missed spell');
}finally{
 globalThis.document=oldDoc;globalThis.setTimeout=oldSetTimeout;globalThis.clearTimeout=oldClearTimeout;
}
console.log('PASS reproduced stale 47-49F RESIST echo on a missed 0-damage hit and removed only the stale effect');
