import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the actual onFatal callback from the browser module in a constrained
// test context. A source regex alone cannot prove that every earlier echo dies.
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const at=app.indexOf('onFatal:side=>');
assert.ok(at>=0,'battle has an onFatal callback');
const begin=at+'onFatal:'.length;
assert.equal(app.slice(begin,begin+7),'side=>{',
 'fatal callback must own effect cleanup rather than delegating directly to the ceremony');
let depth=0,end=-1;
for(let i=begin+6;i<app.length;i++){
 if(app[i]==='{')depth++;
 if(app[i]==='}')depth--;
 if(depth===0){end=i;break;}
}
assert.ok(end>begin,'fatal callback closes normally');
const source=app.slice(begin,end+1);
const expiredEcho={removed:0,remove(){this.removed++;}};
const newestEcho={removed:0,remove(){this.removed++;}};
const earlierPhase={disposed:0,dispose(){this.disposed++;}};
const lastPhase={disposed:0,dispose(){this.disposed++;}};
const oldLive=[expiredEcho,newestEcho];
const arena={querySelectorAll(selector){
 assert.equal(selector,'.combat-fx-echo');
 return oldLive;
}};
let clears=0;
const calls=[];
const onFatal=new Function('$','activeEchoes','lastEcho','clearCombatEffects','ceremony','profile',
 'return ('+source+');')(
 id=>{assert.equal(id,'battleArena');return arena;},
 [earlierPhase,lastPhase],
 lastPhase,
 ()=>clears++,
 (event,title,name)=>{calls.push({event,title,name});return 'ceremony-started';},
 {name:'冒険者',run:{enemyName:'敵'}}
);
const result=onFatal('enemy');
assert.equal(result,'ceremony-started');
assert.deepEqual(calls,[{event:'enemy-death',title:'討伐成功',name:'敵'}]);
assert.equal(clears,1,'live WEAK/RESIST labels and fighter attributes are cleared');
assert.equal(earlierPhase.disposed,1,'all earlier current-round echoes are disposed');
assert.equal(lastPhase.disposed,1,'fatal current-round echo is disposed');
assert.equal(expiredEcho.removed,1,'a still-visible previous-turn WEAK echo is destroyed');
assert.equal(newestEcho.removed,1,'a still-visible previous-turn RESIST echo is destroyed');
console.log('PASS actual fatal callback removes every old visual echo before death ceremony');
