import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','enemies','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const flame={role:'attack',attribute:'flame',power:681};
const starting={hp:110,mag:12,def:10,res:10};
const reported=[28,29,47,48,49];
let checked=0,guarded=0,misses=0;
for(const layer of reported){
 const prefix=String(layer).padStart(3,'0');
 const rows=enemies.filter(row=>new RegExp('^(foe|boss)_l'+prefix+'(?:_|$)').test(row.id));
 assert.equal(rows.length,5,'four enemies and the layer boss must be checked at '+layer+'F');
 for(const row of rows){
  const level=Number(row.min_level);
  const hero=G.makeUnit(starting,level,{},[flame],'player');
  const enemy=G.fromEnemy(row,level);
  const raw=G.damage(hero,enemy,flame,()=>0);
  assert.ok(raw>0,row.id+': without dizziness a 681-power flame hit cannot be zero');
  assert.ok(G.resist(enemy,'flame')>0,row.id+': permanent elemental resistance cannot be immunity');
  const unguarded=[];
  G.round(hero,enemy,0,-1,buffs,()=>0,event=>unguarded.push(event));
  const hit=unguarded.find(event=>event.side==='hero'&&event.role==='attack');
  assert.ok(hit?.amount>0,row.id+': a zero random draw without dizziness must still hit');
  if(attackHitAffinity(hit)!=='none')assert.ok(hit.amount>0,'RESIST/WEAK must be based on landed damage');

  // The actual enemy's own guard spell resolves before the player's attack.
  // Guarding can reduce a hit, but may not silently remove all damage.
  const defender=G.fromEnemy(row,level);
  const defenseIndex=defender.spells.findIndex(spell=>spell.role==='defense');
  assert.ok(defenseIndex>=0,row.id+': test includes the enemy's real defense spell');
  const defended=[];
  G.round(G.makeUnit(starting,level,{},[flame],'player'),defender,0,defenseIndex,buffs,()=>.99,
   event=>defended.push(event));
  assert.ok(defended.some(event=>event.side==='enemy'&&event.role==='defense'));
  const resisted=defended.find(event=>event.side==='hero'&&event.role==='attack');
  assert.ok(resisted?.amount>0,row.id+': enemy defense alone cannot cause a 0-damage flame attack');
  guarded++;

  // Dizziness is an intentional 0-hit route. No new RESIST/WEAK text may
  // appear when the 0 is due to a missed cast, regardless of target resists.
  const dizzy=G.makeUnit(starting,level,{},[flame],'player');
  G.addStatus(dizzy,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:.45,turns:2});
  const missFrames=[];
  G.round(dizzy,G.fromEnemy(row,level),0,-1,buffs,()=>0,event=>missFrames.push(event));
  const miss=missFrames.find(event=>event.side==='hero'&&event.role==='attack');
  assert.equal(miss?.amount,0,row.id+': a successful dizzy roll is the explicit 0-damage outcome');
  assert.equal(attackHitAffinity(miss),'none',row.id+': a missed hit must not render fresh RESIST/WEAK');
  misses++;
  checked++;
 }
}

// 47–49F can contain a legitimate enemy healing spell. Assert that its
// HP restoration and the player's actual damage are independent turn phases.
for(const layer of [47,48,49]){
 const row=enemies.find(e=>e.id==='boss_l'+String(layer).padStart(3,'0'));
 const enemy=G.fromEnemy(row,Number(row.min_level));
 const support=enemy.spells.findIndex(spell=>spell.role==='support');
 assert.ok(support>=0,'boss has a real support spell on '+layer+'F');
 enemy.hp=Math.max(1,Math.floor(enemy.hp/2));
 const hero=G.makeUnit(starting,Number(row.min_level),{},[flame],'player');
 const events=[];
 G.round(hero,enemy,0,support,buffs,()=>.99,event=>events.push(event));
 const heal=events.find(event=>event.side==='enemy'&&event.role==='support');
 const strike=events.find(event=>event.side==='hero'&&event.role==='attack');
 assert.ok(heal?.amount>0,layer+'F: the enemy truly restored HP');
 assert.ok(strike?.amount>0,layer+'F: the player still landed an independent hit');
 assert.ok(events.indexOf(heal)<events.indexOf(strike),'healing precedes attacking in the shared combat core');
}

assert.equal(checked,25);
assert.equal(guarded,25);
assert.equal(misses,25);
console.log('PASS 28/29/47/48/49F real enemy hit, defense, dizziness, affinity and healing matrix');
