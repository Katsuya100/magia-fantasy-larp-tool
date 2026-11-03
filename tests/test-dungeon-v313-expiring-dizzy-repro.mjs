import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','enemies','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const flame={role:'attack',attribute:'flame',power:681};
let reproduced=0;
for(const layer of [28,29]){
 const real=enemies.filter(x=>new RegExp('^(?:foe|boss)_l'+String(layer).padStart(3,'0')+'(?:_|$)').test(x.id));
 assert.equal(real.length,5,'include all real opponents in the reported layer');
 for(const row of real){
  const level=Number(row.min_level);
  const stats={hp:110,mag:12,def:10,res:10};
  const hero=G.makeUnit(stats,level,{},[flame],'player');
  const enemy=G.fromEnemy(row,level);
  // A final-turn storm dizziness is still active while the spell resolves,
  // but is removed when the round ends. The final UI can show no dizziness.
  G.addStatus(hero,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:.45,turns:1});
  const beforeMp=hero.mp,beforeEnemyHp=enemy.hp,steps=[];
  const log=G.round(hero,enemy,0,-1,buffs,()=>0,event=>steps.push(event));
  const cast=steps.find(step=>step.side==='hero'&&step.role==='attack');
  assert.equal(cast?.amount,0,row.id+': final-turn dizziness reproduces a real zero hit');
  assert.equal(enemy.hp,beforeEnemyHp,row.id+': zero hit makes no enemy HP change');
  assert.ok(log.includes('自分：MISS'),row.id+': final-turn dizziness logs a real MISS');
  assert.equal(cast.text,'自分：MISS',row.id+': timeline text matches battle log');
  assert.ok(hero.mp<beforeMp,row.id+': MP was spent by the real missed cast');
  assert.ok(hero.cooldowns[0]>0,row.id+': the missed cast goes on cooldown');
  assert.ok(cast.hero.statuses.some(s=>s.effect==='dizzy'),
   row.id+': the combat frame retains the cause at the moment of attack');
  assert.equal(hero.statuses.some(s=>s.effect==='dizzy'),false,
   row.id+': the resolved state has no dizzy icon after the final tick');
  // Control: the identical opponent and flame circle hit when not dizzy.
  const normal=G.makeUnit(stats,level,{},[flame],'player'),target=G.fromEnemy(row,level);
  const ordinary=[];
  G.round(normal,target,0,-1,buffs,()=>0,step=>ordinary.push(step));
  assert.ok(ordinary.some(step=>step.side==='hero'&&step.role==='attack'&&step.amount>0),
   row.id+': clean state must be distinguished from the expiring status');
  reproduced++;
 }
}
assert.equal(reproduced,10);
console.log('PASS 10 real 28–29F foes: expiring dizziness spends MP/cooldown and deals zero without a POST-turn dizziness icon');
