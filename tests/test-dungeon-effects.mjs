import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num,level,floor} from '../assets/js/dungeon-tuning.mjs';
const get=async p=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+p+'.csv',import.meta.url),'utf8'));
const [enemies,items,collections,buffs,balance,levels,floors,playerBase]=await Promise.all(['enemies','consumables','collections','buffs','balance','levels','floors','player-base'].map(get));
const config={balance,levels,floors,playerBase};configure(config);
const base={hp:110,mag:12,def:10,res:10};
const unit=(spells=[])=>G.makeUnit(base,1,{},spells);
const spell=(role,attribute,power=300)=>({role,attribute,power});
assert.deepEqual(G.ATTRS,['flame','bolt','aqua','storm','gravity','law','chaos']);
assert.equal(G.ROLES.length,4);
for(const a of G.ATTRS){
 const src=unit(),target=unit(),op=spell('attack',a);
 G.cast(src,target,op,buffs,()=>.9);
 assert.ok(target.hp<target.stats.hp,'attack '+a);
 assert.equal(target.statuses.length,0,'pure attack '+a);
 const before=target.hp;
 G.cast(src,target,spell('debuff',a),buffs,()=>.1);
 assert.equal(target.hp,before,'debuff is non-damaging '+a);
 assert.ok(target.statuses.length>0,'elemental debuff '+a);
 target.hp=20;
 G.cast(target,src,spell('support',a),buffs);
 assert.ok(target.hp>20,'healing '+a);
 assert.equal(target.statuses.filter(s=>s.kind==='debuff'&&s.attribute===a).length,0,'element cleansing '+a);
 G.cast(src,target,spell('defense',a),buffs,()=>.2);
 assert.ok(G.resist(src,a)<1,'attribute resistance '+a);
 assert.ok(src.statuses.some(s=>s.kind==='buff'&&s.id!=='resist_'+a),'element buff '+a);
}

 // Defense resolves before the attack phase. It protects the casting round
 // and the next three rounds, then expires before the fifth attack.
 assert.equal(num('resistance_buff_duration'),4);
 for(const row of buffs.filter(x=>x.id.startsWith('buff_')))assert.equal(Number(row.duration),4,'defense buff lasts four rounds '+row.id);
 for(const attr of G.ATTRS){
  const attack=spell('attack',attr);
  const fighterBase={hp:1000,mag:12,def:10,res:10};
  const defender=G.makeUnit(fighterBase,1,{},[spell('defense',attr)]);
  const attacker=G.makeUnit(fighterBase,1,{},[attack,attack]);
  const normalDamage=G.damage(attacker,defender,attack,()=>.99);
  const damageTaken=[],resistTurns=[],bonusTurns=[];
  for(let turn=0;turn<5;turn++){
   const before=defender.hp;
   G.round(defender,attacker,turn===0?0:-1,turn%2,buffs,()=>.99);
   damageTaken.push(before-defender.hp);
   resistTurns.push(G.status(defender,'resist_'+attr)?.turns??0);
   bonusTurns.push(defender.statuses.find(x=>x.id.startsWith('buff_'))?.turns??0);
  }
  assert.deepEqual(resistTurns,[3,2,1,0,0],'resistance expires after four attack phases: '+attr);
  assert.deepEqual(bonusTurns,[3,2,1,0,0],'secondary buff tracks resistance: '+attr);
  assert.ok(damageTaken.slice(0,4).every(d=>d<normalDamage),'four protected hits: '+attr+' '+damageTaken);
  assert.equal(damageTaken[4],normalDamage,'fifth hit is unprotected: '+attr);
 }

for(const attr of G.ATTRS){
 const u=unit();
 G.addStatus(u,{id:'debuff_'+attr,kind:'debuff',attribute:attr,effect:'burn',value:.5,turns:2});
 G.addStatus(u,{id:'unrelated',kind:'debuff',attribute:'unrelated',effect:'output',value:-.1,turns:2});
 const clear=items.find(x=>x.id==='clear_'+attr);
 assert.ok(clear,'clear potion '+attr);
 G.potion(u,{id:clear.id,value:0,bonus:clear.bonus_buff_id},items,buffs);
 assert.equal(u.statuses.some(s=>s.attribute===attr&&s.kind==='debuff'),false);
 assert.ok(u.statuses.find(s=>s.id==='unrelated'),'does not over-cleanse');
 assert.ok(G.resist(u,attr)<1,'bonus improves matching resistance');
}
const a=unit([spell('attack','flame')]),b=unit([spell('attack','flame')]);
const beforeA=a.hp,beforeB=b.hp;
G.round(a,b,0,0,buffs,()=>.99);
assert.equal(beforeA-a.hp,beforeB-b.hp,'both entities use identical rules');
assert.equal(a.mp,b.mp);
assert.equal(a.cooldowns[0],b.cooldowns[0]);
assert.equal(G.available(a).length,0,'cooldown');
G.round(a,b,-1,-1,buffs,()=>.99);
assert.ok(G.available(a).includes(0),'cooldown expires');
const x=unit([spell('attack','law'),spell('support','law')]);
G.addStatus(x,{id:'debuff_law',kind:'debuff',effect:'seal',attribute:'law',sealedRole:'attack',value:1,turns:2});
assert.equal(G.canCast(x,0),false,'sealed attacks blocked');
assert.equal(G.canCast(x,1),true,'different sigil remains');
const shocked=unit([spell('attack','flame')]);
G.addStatus(shocked,{id:'debuff_bolt',kind:'debuff',attribute:'bolt',effect:'shock',value:1,turns:2});
G.prepare(shocked,0);
assert.equal(shocked.cooldowns[0],num('spell_cooldown')+num('shock_cooldown_extra'));
const dizzy=unit(),victim=unit();
G.addStatus(dizzy,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:.4,turns:2});
assert.equal(G.damage(dizzy,victim,spell('attack','law'),()=>0),0);
assert.ok(G.damage(dizzy,victim,spell('attack','law'),()=>.99)>0);
const burnt=unit([spell('defense','law')]),normal=unit([spell('defense','law')]),other=unit([spell('defense','law')]);
G.addStatus(burnt,{id:'debuff_flame',kind:'debuff',attribute:'flame',effect:'burn',value:1,turns:2});
G.round(burnt,other,-1,-1,buffs,()=>.99);
G.round(normal,unit(),-1,-1,buffs,()=>.99);
assert.ok(burnt.hp<normal.hp,'burn deals delayed status damage');
const wet=unit();
G.addStatus(wet,{id:'resist_aqua',kind:'buff',attribute:'aqua',effect:'resist',value:.4,turns:2});
const dryRes=G.resist(wet,'aqua');
G.addStatus(wet,{id:'debuff_aqua',kind:'debuff',attribute:'aqua',effect:'soak',value:.5,turns:2});
assert.ok(G.resist(wet,'aqua')>dryRes,'soaking degrades resistance buffs');
const chaos=unit([spell('attack','law'),spell('support','law')]);
G.addStatus(chaos,{id:'debuff_chaos',kind:'debuff',attribute:'chaos',effect:'confused',value:1,turns:2});
G.prepare(chaos,0,()=>.99);
assert.equal(G.status(chaos,'debuff_chaos'),undefined,'confusion consumed by cast');
const foe1=G.makeUnit(base,1,{flame:.3},[spell('attack','flame')]);
const foe2=G.makeUnit(base,1,{flame:1.4},[spell('attack','flame')]);
assert.ok(G.damage(a,foe1,spell('attack','flame'))<G.damage(a,foe2,spell('attack','flame')),'enemy-specific resistance');
for(let lv=1;lv<=150;lv++){
 const row=level(lv);assert.ok(+row.carry_limit>=3&&+row.carry_limit<=18);
 if(lv>1)assert.ok(+row.hp_multiplier>=+level(lv-1).hp_multiplier);
 assert.ok(+row.xp_to_next>0);
}
for(let f=1;f<=500;f++){
 const spec=floor(f);assert.ok(+spec.enemy_level>=1);
 if(+spec.boss===1)assert.ok(enemies.some(e=>e.id===spec.boss_enemy_id));
}
for(const en of enemies){
 const u=G.fromEnemy(en,Math.max(1,+en.min_level));
 assert.equal(u.spells.length,5);
 assert.equal(Object.keys(u.resists).length,7);
 assert.ok(u.spells.every(sp=>G.ROLES.includes(sp.role)&&G.ATTRS.includes(sp.attribute)&&sp.power>0));
}
for(const item of items){assert.ok(+item.max_value>=+item.min_value);if(item.bonus_buff_id)assert.ok(buffs.some(b=>b.id===item.bonus_buff_id),'valid bonus '+item.id);}
for(const collection of collections)assert.ok(+collection.weight>0);
assert.deepEqual(G.parseCsv('key,name\n1,"quoted,value"\n'),[{key:'1',name:'quoted,value'}]);
assert.throws(()=>G.parseCsv('key,name\n1\n'),/CSV columns/);
const altered=config.balance.map(row=>({...row,value:row.key==='spell_cooldown'?'4':row.value}));
configure({...config,balance:altered});
const modified=unit([spell('attack','law')]);G.prepare(modified,0);
assert.equal(modified.cooldowns[0],4,'balance edit changes runtime');
configure(config);
let draw=0;
const onlyCollection=G.drops(items,collections,1,()=>++draw===1?0:.99);
assert.equal(onlyCollection.length,1);
assert.equal(onlyCollection[0].type,'collection');
assert.ok(collections.some(x=>x.id===onlyCollection[0].id));
const onlyPotions=G.drops(items,collections,99,()=>0);
assert.equal(onlyPotions.filter(item=>item.type==='use').length,3);
assert.ok(onlyPotions.filter(item=>item.type==='use').every(item=>item.value>=0));
const mp=unit();mp.mp=0;G.potion(mp,{id:'mana_s',value:24,bonus:null},items,buffs);
assert.equal(mp.mp,24);
const hpPotion=unit();hpPotion.hp=hpPotion.stats.hp-3;
G.potion(hpPotion,{id:'heal_l',value:1000,bonus:null},items,buffs);
assert.equal(hpPotion.hp,hpPotion.stats.hp,'healing clamps at max');
console.log('PASS 7 elements x 4 sigils, 7 cleansers, debuff mechanics, 150 levels, 500 fights, CSV references and tunable rules');
