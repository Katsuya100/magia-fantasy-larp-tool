// Canonical test-only contracts: fail on invalid measurements, never repair them.
import assert from 'node:assert/strict';
export const FIXED_CARRY={1:[0,0],11:[0,0],21:[0,0],31:[0,0],41:[0,0],51:[13,0],61:[14,0],71:[13,2],81:[14,2],91:[16,2]};
export function assertFixedInventory(from,items){
 const expected=FIXED_CARRY[from];assert.ok(expected,'unknown fixed band');
 assert.equal(items.length,expected[0]+expected[1],'fixed carry count');
 assert.equal(items.filter(id=>id==='luna_stone').length,expected[1],'Luna count');
 assert.equal(items.filter(id=>/^clear_(flame|bolt|aqua|storm|gravity|law|chaos)$/.test(id)).length,expected[0],'specialist cleansers');
 assert.ok(items.every(id=>id==='luna_stone'||/^clear_(flame|bolt|aqua|storm|gravity|law|chaos)$/.test(id)),'no forbidden fixed consumables');
}
export function assertFixedTrace(run,from,to){
 assert.equal(to,from+9,'50-fight band only');
 assertFixedInventory(from,run.initialLoadout);
 assert.ok(run.layerStats.length>0&&run.layerStats.length<=10);
 assert.equal(run.layerStats[0].layer,from);
 assert.equal(run.layerStats[0].startHp,run.maxHp);
 assert.equal(run.layerStats[0].startMp,run.maxMp);
 assert.equal(run.restores??0,0,'no mid-sortie full recovery');
 for(let i=1;i<run.layerStats.length;i++){
  const a=run.layerStats[i-1],b=run.layerStats[i];
  assert.equal(a.cleared,true,'previous floor must be cleared');
  assert.equal(b.layer,a.layer+1);
  assert.equal(b.startHp,a.endHp,'no inter-floor HP recovery');
  assert.equal(b.startMp,a.endMp,'no inter-floor MP recovery');
  if(from>=51)assert.equal(b.itemsAtStart,a.itemsAtEnd,'no free item restock');
 }
 if(run.win){assert.equal(run.layerStats.length,10);assert.equal(run.cleared,to*5);}
}
export const journeySpellAllowed=(layer,unlocked,role)=>
 role==='attack'||role==='basic'||Boolean(unlocked)&&(layer>=6||layer>=3&&role!=='support');
export const journeyItemAllowed=(layer,kind)=>layer>=6||kind==='mana';
export function assertPairedCharacters(a,b){
 for(const k of ['level','rank','playerHp','playerMp','maxHp','maxMp','playerBase','carry','statuses','cooldowns'])
  assert.deepEqual(a[k],b[k],'unequal paired character condition: '+k);
 assert.equal(a.circles.length,5);assert.equal(b.circles.length,5);
}
export function assert256Seeds(seeds){
 assert.equal(seeds.length,256,'no reduced seed denominator');
 assert.equal(new Set(seeds).size,256,'no duplicate or dropped seeds');
}
