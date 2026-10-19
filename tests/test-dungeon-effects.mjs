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

// Same upgraded-power formula for player and enemy. Defense protects immediately,
// remains active for the configured count, then expires; bonus and resist match.
assert.equal(num('defense_duration_base'),2);
assert.equal(num('defense_duration_power_step'),250);
assert.equal(num('defense_duration_cap'),6);
for(const [power,duration] of [[49,2],[168,2],[249,2],[250,3],[270,3],[499,3],[500,4],[540,4],[749,4],[750,5],[999,5],[1000,6],[1500,6]]){
 assert.equal(G.defenseDuration({power}),duration,'power breakpoint '+power);
}
for(const attr of G.ATTRS)for(const [power,duration] of [[120,2],[270,3],[540,4],[800,5],[1000,6]]){
 const attack=spell('attack',attr);
 const fighterBase={hp:1500,mag:12,def:10,res:10};
 const defender=G.makeUnit(fighterBase,1,{},[spell('defense',attr,power)]);
 const attacker=G.makeUnit(fighterBase,1,{},[attack,attack]);
 const normalDamage=G.damage(attacker,defender,attack,()=>.99);
 const damageTaken=[],resistTurns=[],bonusTurns=[];
 for(let turn=0;turn<7;turn++){
  const before=defender.hp;
  G.round(defender,attacker,turn===0?0:-1,turn%2,buffs,()=>.99);
  damageTaken.push(before-defender.hp);
  resistTurns.push(G.status(defender,'resist_'+attr)?.turns??0);
  bonusTurns.push(defender.statuses.find(x=>x.id.startsWith('buff_'))?.turns??0);
 }
 const expectedTurns=Array.from({length:7},(_,i)=>Math.max(0,duration-i-1));
 assert.deepEqual(resistTurns,expectedTurns,'resistance countdown '+attr+' P'+power);
 assert.deepEqual(bonusTurns,expectedTurns,'extra buff countdown '+attr+' P'+power);
 assert.ok(damageTaken.slice(0,duration).every(d=>d<normalDamage),'protected hits '+attr+' P'+power);
 assert.ok(damageTaken.slice(duration).every(d=>d===normalDamage),'unprotected hits '+attr+' P'+power);
}
const upgraded={role:'defense',attribute:'flame',power:1000,basePower:270};
assert.equal(G.defenseDuration(upgraded),6,'stone-upgraded power, not original MP basis');
for(const attr of G.ATTRS)for(const [power,duration] of [[120,2],[270,3],[540,4],[800,5],[1000,6]]){
 const curse=spell('debuff',attr,power);
 assert.equal(G.statusDuration(curse),G.defenseDuration(curse),'shared status formula');
 const hero=G.makeUnit({hp:3000,mag:12,def:10,res:10},1,{},[],'player');
 const foe=G.makeUnit({hp:3000,mag:12,def:10,res:10},1,{},[curse],'enemy');
 const countdown=[];
 for(let i=0;i<7;i++){
  G.round(hero,foe,-1,i===0?0:-1,buffs,()=>.1);
  countdown.push(G.status(hero,'debuff_'+attr)?.turns??0);
 }
 assert.deepEqual(countdown,Array.from({length:7},(_,i)=>Math.max(0,duration-i-1)),
  'debuff countdown, same as defense '+attr+' P'+power);
}
const caster=unit();
for(const power of [270,540,1000]){
 const curse=spell('debuff','flame',power);
 const resistant=G.makeUnit(base,1,{flame:.25},[],'player');
 const vulnerable=G.makeUnit(base,1,{flame:1.5},[],'enemy');
 G.cast(caster,resistant,curse,buffs,()=>.99);
 G.cast(caster,vulnerable,curse,buffs,()=>.99);
 const a=G.status(resistant,'debuff_flame'),b=G.status(vulnerable,'debuff_flame');
 assert.equal(a.turns,G.statusDuration(curse));
 assert.equal(b.turns,a.turns,'same turns with different target resistance/side');
 assert.ok(b.value>a.value,'resistance still reduces debuff intensity');
}
assert.equal(G.statusDuration({role:'debuff',attribute:'flame',power:1000,basePower:270}),6,
 'stone-upgraded debuff power, not MP basis, sets duration');

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
// Burn keeps a fraction of target maximum HP, but upgraded power changes the percentage.
const burnCaster=unit(),burnSpell=power=>spell('debuff','flame',power);
const burnTarget=hp=>G.makeUnit({hp,mag:12,def:10,res:10},1,{},[],'enemy');
const burnSmall=burnTarget(110),burnLarge=burnTarget(2000);
G.cast(burnCaster,burnSmall,burnSpell(270),buffs);
G.cast(burnCaster,burnLarge,burnSpell(270),buffs);
const burnLow=G.status(burnSmall,'debuff_flame');
const burnTall=G.status(burnLarge,'debuff_flame');
assert.equal(burnLow.value,burnTall.value,'same power gives same burn percentage across HP sizes');
assert.equal(G.debuffPowerFactor(burnSpell(500)),1,'power 500 is the debuff reference');
assert.ok(G.debuffPowerFactor(burnSpell(1000))>G.debuffPowerFactor(burnSpell(270)));
const burnHigh=burnTarget(2000);
G.cast(burnCaster,burnHigh,burnSpell(1000),buffs);
assert.ok(G.status(burnHigh,'debuff_flame').value>burnLow.value,
 'higher upgraded spell power increases burn percentage');
const fireResistant=G.makeUnit({hp:2000,mag:12,def:10,res:10},1,{flame:.25},[],'enemy');
G.cast(burnCaster,fireResistant,burnSpell(270),buffs);
assert.ok(G.status(fireResistant,'debuff_flame').value<burnLow.value,
 'flame resistance reduces burn percentage');
const burnStack=burnTarget(2000);
G.cast(burnCaster,burnStack,burnSpell(270),buffs);
G.cast(burnCaster,burnStack,burnSpell(1000),buffs);
const strongest=G.status(burnStack,'debuff_flame').value;
G.cast(burnCaster,burnStack,burnSpell(270),buffs);
assert.equal(G.status(burnStack,'debuff_flame').value,strongest,
 'reapplying a weaker burn must not lower the HP percentage');
const tickFor=(target,value)=>Math.max(num('status_tick_min_damage'),Math.round(target.stats.hp*num('burn_hp_rate')*value));
const lowTick=tickFor(burnSmall,burnLow.value),largeTick=tickFor(burnLarge,burnTall.value);
assert.ok(largeTick>lowTick,'same burn power scales with target maximum HP');
const ticks=[];
G.round(burnLarge,unit(),-1,-1,buffs,()=>.99,event=>{
 if(event.role==='burn')ticks.push(event.amount);
});
assert.deepEqual(ticks,[largeTick],'one max-HP-based end-of-round burn tick');
const enemyBurnCaster=G.makeUnit(base,1,{},[],'enemy');
const playerBurnTarget=G.makeUnit({hp:110,mag:12,def:10,res:10},1,{},[],'player');
G.cast(enemyBurnCaster,playerBurnTarget,burnSpell(270),buffs);
assert.equal(G.status(playerBurnTarget,'debuff_flame').value,burnLow.value,
 'players and enemies receive identical burn strength');

const wet=unit();
G.addStatus(wet,{id:'resist_aqua',kind:'buff',attribute:'aqua',effect:'resist',value:.4,turns:2});
const dryRes=G.resist(wet,'aqua');
G.addStatus(wet,{id:'debuff_aqua',kind:'debuff',attribute:'aqua',effect:'soak',value:.5,turns:2});
assert.ok(G.resist(wet,'aqua')>dryRes,'soaking degrades resistance buffs');

// Upgraded power also controls soak, dizzy, gravity, shock and seal.
const curseCaster=unit();
const lowSoak=unit(),highSoak=unit();
G.cast(curseCaster,lowSoak,spell('debuff','aqua',270),buffs);
G.cast(curseCaster,highSoak,spell('debuff','aqua',1000),buffs);
assert.ok(G.resist(lowSoak,'flame')>1,'soaking exposes base resistance, even without buffs');
assert.ok(G.resist(highSoak,'flame')>G.resist(lowSoak,'flame'),'high power increases soak vulnerability');
const lowDizzy=unit(),highDizzy=unit();
G.cast(curseCaster,lowDizzy,spell('debuff','storm',270),buffs);
G.cast(curseCaster,highDizzy,spell('debuff','storm',1000),buffs);
assert.ok(G.status(highDizzy,'debuff_storm').value>G.status(lowDizzy,'debuff_storm').value);
const dizzyVictim=unit(),beforeDizzyVictim=dizzyVictim.hp;
G.round(highDizzy,dizzyVictim,-1,-1,buffs,()=>0);
assert.equal(dizzyVictim.hp,beforeDizzyVictim,'dizzy can also miss normal attacks');
const lowGravity=unit(),highGravity=unit();
G.cast(curseCaster,lowGravity,spell('debuff','gravity',270),buffs);
G.cast(curseCaster,highGravity,spell('debuff','gravity',1000),buffs);
assert.ok(G.factor(highGravity,'output')<G.factor(lowGravity,'output'),'gravity reduces output more with power');
const shockTarget=()=>unit([spell('attack','flame')]);
for(const [power,extra] of [[270,1],[540,2],[1000,3]]){
 const victim=shockTarget();
 G.cast(curseCaster,victim,spell('debuff','bolt',power),buffs);
 assert.equal(G.status(victim,'debuff_bolt').shockExtra,extra,'shock tier '+power);
 G.prepare(victim,0);
 assert.equal(victim.cooldowns[0],num('spell_cooldown')+extra,'shock cooldown '+power);
}
const sealedTarget=()=>unit([spell('attack','flame'),spell('defense','flame'),spell('support','flame'),spell('debuff','flame')]);
const lowSeal=sealedTarget(),highSeal=sealedTarget();
G.cast(curseCaster,lowSeal,spell('debuff','law',270),buffs,()=>.99);
G.cast(curseCaster,highSeal,spell('debuff','law',1000),buffs,()=>.99);
assert.equal(G.status(lowSeal,'debuff_law').sealedRoles.length,1,'low-power seal blocks one role');
const roles=G.status(highSeal,'debuff_law').sealedRoles;
assert.equal(roles.length,2,'high-power seal blocks exactly two roles');
assert.equal(new Set(roles).size,2,'sealed roles must differ');
for(let i=0;i<4;i++)assert.equal(G.canCast(highSeal,i),!roles.includes(highSeal.spells[i].role),'two-role seal enforcement');
G.cast(curseCaster,highSeal,spell('debuff','law',270),buffs,()=>0);
assert.ok(G.status(highSeal,'debuff_law').sealedRoles.length<=2,'reapplying seal never exceeds two roles');
const chaosTarget=unit([spell('attack','flame'),spell('support','aqua')]);
G.cast(curseCaster,chaosTarget,spell('debuff','chaos',540),buffs,()=>.99);
assert.equal(G.status(chaosTarget,'debuff_chaos').effect,'confused','chaos applies its own status only');
assert.equal(chaosTarget.statuses.length,1,'chaos does not also apply unrelated debuffs');
const chaosCast=G.prepare(chaosTarget,0,()=>.99);
assert.equal(chaosCast.role,'support','chaos randomly changes the next magic');
assert.equal(G.status(chaosTarget,'debuff_chaos'),undefined,'chaos is consumed after cast');
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
