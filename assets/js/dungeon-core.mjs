import {num,level,range} from './dungeon-tuning.mjs';
import {rollCollection,bossUniqueCollection,rollConsumableTier,eligibleConsumables,CONSUMABLE_TIERS,targetClearLevel} from './dungeon-design.mjs';
import {MAGIC_INK_ID,bossDropsMagicInk} from './dungeon-ink.mjs';
export const ATTRS=['flame','bolt','aqua','storm','gravity','law','chaos'];
export const ROLES=['attack','defense','support','debuff'];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const roll=(a,b,r=Math.random)=>a+Math.floor(r()*(b-a+1));
export const capacity=level=>+levelRow(level).carry_limit;
// EXP uses the approved scaling while overlevel replay receives less EXP;
// this does not touch the independently rolled magic stone economy.
export const XP_SCALE=45;
// A fifth of an integer layer budget may be 0.2 EXP. Normalize each stored
// accumulation to micro-EXP so five battles land on their exact threshold.
export const normalizeXp=value=>Math.round(Number(value)*1e6)/1e6;
// EXP is fractional internally so five fights sum to the exact level budget.
// Keep the display short without changing the stored value.
const xpDisplay=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1});
export const formatXp=value=>xpDisplay.format(Number(value)||0);
// Grow steeply until Lv100 to limit lower-floor replay, then taper so
// the high-end required and earned EXP values remain under six figures.
export const nextXp=level=>{
 const steps=(Number(level)-1)/10;
 const earlySteps=Math.min(steps,9.9);
 const lateSteps=Math.max(0,steps-9.9);
 return Math.ceil(Number(levelRow(level).xp_to_next)*
  Math.pow(num('xp_growth_per_10_levels'),earlySteps)*
  Math.pow(num('xp_growth_per_10_levels_late'),lateSteps)/XP_SCALE);
};
// Five fights at the intended level supply approximately the XP needed
// to start the following layer. Replay rewards do not decay.
export function fightExperience(enemyLevel,playerLevel,layer){
 if(Number(playerLevel)>=num('level_max'))return 0;
 const current=targetClearLevel(Number(layer));
 const next=targetClearLevel(Number(layer)+1);
 const budget=next>current
  ?Array.from({length:next-current},(_,i)=>nextXp(current+i)).reduce((a,b)=>a+b,0)
  :nextXp(current);
 // At-level or under-leveled victories keep the existing designed
 // five-fight XP budget. Farming substantially weaker layers must not
 // overlevel away the 95% target before a real encounter takes place.
 // One 10-level gap uses the current 1.85 early progression factor as a
 // source-controlled, tunable game value (no test-only level rewrites).
 const gap=Math.max(0,Number(playerLevel)-current);
 const decay=num('xp_overlevel_decay_per_10_levels');
 if(!(decay>=1&&Number.isFinite(decay)))throw Error('Invalid overlevel EXP falloff');
 return budget/5/Math.pow(decay,gap/10);
}
// Identical rules for both sides: use raw power after UGC/stone upgrades.
// Same upgraded-power duration applies to defense and debuff, hero and enemy.
export function statusDuration(spell){
 const step=num('defense_duration_power_step');
 if(step<=0)return num('resistance_buff_duration'); // Retain existing duration overrides and tests.
 const base=num('defense_duration_base'),cap=num('defense_duration_cap');
 const power=Math.max(0,Number(spell?.power)||0);
 return clamp(base+Math.floor(power/step),1,cap);
}
export const defenseDuration=statusDuration; // Compatibility for existing API consumers.
export const basePower=p=>Math.round(num('power_scale')*Math.sqrt(Math.max(0,p)/num('power_divisor')));
export const mpCost=p=>num('mp_cost_base')+Math.ceil(basePower(p)/num('mp_cost_divisor'));
export const spellMpCost=spell=>mpCost(spell.basePower??spell.power);
const levelRow=l=>level(l);
const growthKeys=['hp','mag','def','res'];
export const startingBase=(r=Math.random)=>Object.fromEntries(growthKeys.map(k=>[k,roll(...range(k),r)]));
export function stats(base,level){const record=levelRow(level);return Object.fromEntries(growthKeys.map(k=>[k,Math.round(base[k]*Number(record[k+'_multiplier']))]));}
export function makeUnit(base,level,resists={},spells=[],id='unit'){
 const s=stats(base,level);return {id,level,base,stats:s,hp:s.hp,maxMp:num('mp_base')+num('mp_per_mag')*s.mag,mp:num('mp_base')+num('mp_per_mag')*s.mag,spells:spells.map(x=>x?({...x}):null),cooldowns:spells.map(()=>0),statuses:[],reviveArmed:false,reviveUsed:false,resists:Object.fromEntries(ATTRS.map(a=>[a,Number(resists[a]??num('base_resistance'))]))};
}
export function parseCsv(input){
 const records=[];let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){const ch=input[i];
  if(quoted){if(ch==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
  else if(ch==='"')quoted=true;
  else if(ch===','){row.push(cell);cell='';}
  else if(ch==='\n'){row.push(cell.replace(/\r$/,''));if(row.some(x=>x.trim()))records.push(row);row=[];cell='';}
  else cell+=ch;
 }
 if(quoted)throw Error('Unclosed CSV quote');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));records.push(row);}
 const header=records.shift();if(!header||header.some(x=>!x))throw Error('CSV header');
 return records.map(cols=>{if(cols.length!==header.length)throw Error('CSV columns');return Object.fromEntries(header.map((name,i)=>[name,cols[i]]));});
}
export function weighted(rows,r=Math.random){let sum=rows.reduce((n,x)=>n+Number(x.weight||0),0),v=r()*sum;if(!sum)throw Error('Empty drops');for(const row of rows){v-=Number(row.weight||0);if(v<0)return row;}return rows.at(-1);}
// New potions are rolled against the expected adventurer level at the drop layer.
// 75% is guaranteed even for the highest possible starting HP/MAG roll.
// Store the rolled value on each item so old inventory and later use remain stable.
export function rollPotionValue(item,layer,r=Math.random){
 if(['clear','clear_all','escape','revive'].includes(item.kind))return 0;
 if(item.kind==='elixir')return Number(item.min_value);
 if(item.kind!=='heal'&&item.kind!=='mana')throw Error('Unknown potion kind');
 const recommended=level(targetClearLevel(layer));
 const maximum=item.kind==='heal'
  ?Math.round(range('hp')[1]*Number(recommended.hp_multiplier))
  :num('mp_base')+num('mp_per_mag')*Math.round(range('mag')[1]*Number(recommended.mag_multiplier));
 const minimum=Math.max(Number(item.min_value),Math.ceil(maximum*.75));
 const tierCeiling={small:.88,medium:.96,large:1.06,extreme:1.18}[item.tier]||.88;
 const upper=Math.max(minimum,Number(item.max_value),Math.ceil(maximum*tierCeiling));
 return roll(minimum,upper,r);
}
// The three reward types roll independently: a rich collection drop never
// crowds out a magic stone or a usable item. Five fights form one layer.
const countSuccesses=(rolls,chance,r)=>{
 let count=0;
 for(let i=0;i<rolls;i++)if(r()<chance)count++;
 return count;
};
// Reward magic stones increasingly with dungeon depth, including beyond
// the player Lv150 cap. Farming and first clears share the same probability.
// Continuous geometric interpolation avoids sudden jumps at rank checkpoints.
// Keep the existing (playerLevel, layer, firstClear) signature for callers.
export function magicStoneDropChance(_playerLevel,layer=1,_firstClear=false){
 const start=num('magic_stone_drop_chance');
 const end=num('magic_stone_drop_chance_layer_150');
 const maxLayer=num('magic_stone_drop_curve_end_layer');
 if(!(start>0&&end>=start&&end<=1&&Number.isSafeInteger(maxLayer)&&maxLayer>1))
  throw Error('魔導石の排出カーブの設定が不正です。');
 const raw=Number(layer);
 const depth=Number.isFinite(raw)?Math.min(maxLayer,Math.max(1,Math.floor(raw))):1;
 const progress=(depth-1)/(maxLayer-1);
 return Math.min(1,Number((start*Math.pow(end/start,progress)).toFixed(12)));
}
export function dropCounts(_enemyLevel,r=Math.random,context={}){
 const stoneChance=magicStoneDropChance(context.playerLevel,context.layer??1,context.firstClear===true);
 return {
  collection:countSuccesses(num('collection_drop_rolls'),num('collection_drop_chance'),r),
  stone:countSuccesses(num('magic_stone_drop_rolls'),stoneChance,r),
  use:countSuccesses(num('consumable_drop_rolls'),num('consumable_drop_chance'),r)
 };
}
export function dropCount(l,r=Math.random,context={}){
 return Object.values(dropCounts(l,r,context)).reduce((total,count)=>total+count,0);
}
export function drops(items,collections,l,r=Math.random,context={}){
 const layer=context.layer??1,{collection,stone,use}=dropCounts(l,r,context),rewards=[];
 for(let i=0;i<use;i++){
  const tier=rollConsumableTier(layer,r);
  const x=weighted(eligibleConsumables(items,layer,tier),r);
  rewards.push({type:'use',id:x.id,value:rollPotionValue(x,layer,r),
   bonus:x.bonus_buff_id&&r()<Number(x.bonus_chance)?x.bonus_buff_id:null});
 }
 for(let i=0;i<stone;i++)rewards.push({type:'stone',id:'magic_stone'});
 for(let i=0;i<collection;i++)
  rewards.push({type:'collection',id:rollCollection(collections,layer,r,context.bossEnemyId??null,context.favoredCollectionIds).id});
 if(bossDropsMagicInk(context.bossEnemyId,r))rewards.push({type:'ink',id:MAGIC_INK_ID});
 return rewards;
}
export function experience(p,xp){p.xp=normalizeXp(p.xp+xp);while(p.level<num('level_max')&&p.xp>=nextXp(p.level)){p.xp=normalizeXp(p.xp-nextXp(p.level));p.level++;}if(p.level>=num('level_max'))p.xp=0;return p.level;}
export const effectivePower=(actor,spell)=>basePower(spell.power)*actor.stats.mag/num('mag_reference');
export const strength=(actor,spell)=>clamp(effectivePower(actor,spell)/num('magic_magnitude_divisor'),num('magic_magnitude_min'),num('magic_magnitude_max'));
export const debuffPowerFactor=spell=>clamp(Math.sqrt(Math.max(0,Number(spell?.power)||0)/num('debuff_power_reference')),num('debuff_power_min'),num('debuff_power_max'));
export const status=(actor,id)=>actor.statuses.find(s=>s.id===id);
export function addStatus(actor,s){
 const old=status(actor,s.id);
 if(old&&s.id==='debuff_chaos'){Object.assign(old,s);return;}
 if(old){
  old.turns=Math.max(old.turns,s.turns);
  if(Math.abs(s.value)>Math.abs(old.value))old.value=s.value;
  if(s.effect==='shock')old.shockExtra=Math.max(old.shockExtra??num('shock_cooldown_extra'),s.shockExtra??0);
  if(s.effect==='seal'){
   const previous=old.sealedRoles??(old.sealedRole?[old.sealedRole]:[]);
   const incoming=s.sealedRoles??(s.sealedRole?[s.sealedRole]:[]);
   old.sealedRoles=[...new Set([...previous,...incoming])].slice(0,2);
   old.sealedRole=old.sealedRoles[0]??null;
  }
  return;
 }
 actor.statuses.push(s);
}
export function resist(actor,attr){
 let r=actor.resists[attr]??1;
 const buff=status(actor,'resist_'+attr),soak=status(actor,'debuff_aqua');
 if(buff)r*=1-buff.value*(soak?Math.max(0,1-soak.value):1);
 if(soak)r*=1+Math.max(0,soak.value)*num('soak_vulnerability_rate');
 return clamp(r,num('status_min_resistance'),num('status_max_resistance'));
}
export function factor(actor,effect){return clamp(actor.statuses.filter(x=>x.effect===effect).reduce((n,x)=>n*(1+x.value),1),num('modifier_min'),num('modifier_max'));}
export const armor=actor=>Math.ceil(Math.max(0,actor.stats.def+actor.statuses.filter(x=>x.effect==='def').reduce((n,x)=>n+x.value,0)));
export function damage(src,tgt,spell,r=Math.random){const dizzy=status(src,'debuff_storm');if(dizzy&&r()<clamp(dizzy.value,0,num('dizzy_max_rate')))return 0;return Math.max(0,Math.round(effectivePower(src,spell)*resist(tgt,spell.attribute)*factor(src,'attack')*factor(src,'output')*factor(tgt,'incoming')*num('def_divisor')/(num('def_divisor')+armor(tgt))));}
export function isSpellSealed(u,s){return Boolean(s&&u.statuses.some(x=>x.effect==='seal'&&(x.sealedRoles?x.sealedRoles.includes(s.role):x.sealedRole===s.role)));}
export function canCast(u,i){const s=u.spells[i];return Boolean(s&&u.mp>=spellMpCost(s)&&!u.cooldowns[i]&&!isSpellSealed(u,s));}
export const available=u=>u.spells.map((_,i)=>i).filter(i=>canCast(u,i));
// Shared dungeon enemy AI. A flavor-designated curse specialist (one of its
// five spells has role 'debuff') prioritizes that spell when available. Enemies
// without debuffs retain the exact legacy random attack/other spell choice.
export function chooseEnemySpell(unit,r=Math.random){
 const ids=available(unit);
 if(!ids.length)return -1;
 // Only 1-10 layer enemies are limited to attacks and their weakest defense.
 // The tenth-layer boss may select its strongest defense instead.
 // Healing and debuffs never enter these early enemy action choices.
 const early=/^(?:foe|boss)_l(\d{3})(?:_|$)/.exec(String(unit.id));
 if(early&&Number(early[1])<=10){
  const attacks=ids.filter(i=>unit.spells[i].role==='attack');
  const guards=ids.filter(i=>unit.spells[i].role==='defense');
  const attack=()=>attacks[Math.floor(r()*attacks.length)];
  if(!guards.length)return attacks.length?attack():-1;
  // A nearly all-guard opening keeps fifty consecutive fights survivable without HP healing.
  if(attacks.length&&r()<.01)return attack();
  const strongest=unit.id==='boss_l010';
  return guards.reduce((best,i)=>strongest
   ?unit.spells[i].power>unit.spells[best].power?i:best
   :unit.spells[i].power<unit.spells[best].power?i:best);
 }
 const heal=ids.find(i=>unit.spells[i].role==='support');
 if(heal!==undefined&&unit.hp<unit.stats.hp*num('enemy_heal_threshold'))return heal;
 const curse=ids.find(i=>unit.spells[i].role==='debuff');
 if(curse!==undefined&&r()<num('enemy_debuff_specialist_preference'))return curse;
 const offense=ids.filter(i=>unit.spells[i].role==='attack');
 return offense.length&&r()<num('enemy_attack_preference')
  ?offense[Math.floor(r()*offense.length)]:ids[Math.floor(r()*ids.length)];
}

export function prepare(u,i,r=Math.random){if(i===-1)return {role:'basic',attribute:'law',power:0};const confused=status(u,'debuff_chaos');if(confused){const choices=available(u);if(choices.length)i=choices[roll(0,choices.length-1,r)];}if(!canCast(u,i))throw Error('Spell unavailable');const sp=u.spells[i];u.mp-=spellMpCost(sp);u.cooldowns[i]=num('spell_cooldown');const shock=status(u,'debuff_bolt');if(shock){u.cooldowns[i]+=shock.shockExtra??num('shock_cooldown_extra');}return {...sp};}
// Whether a carried item currently has a usable primary effect (or bonus).
// Escape scrolls are always usable; revival can only be armed once per fight.
export function canUseBattleItem(hero,item,items,buffs=[]){
 if(!hero||!item)return false;
 const row=items.find(x=>x.id===item.id);
 if(!row)return false;
 if(row.kind==='escape')return true;
 if(row.kind==='revive')return hero.hp>0&&!hero.reviveArmed&&!hero.reviveUsed;
 const hasBonus=Boolean(item.bonus&&buffs.some(b=>b.id===item.bonus));
 const strength=Number(item.value)>0;
 if(row.kind==='heal')return (strength&&hero.hp<hero.stats.hp)||hasBonus;
 if(row.kind==='mana')return (strength&&hero.mp<hero.maxMp)||hasBonus;
 if(row.kind==='elixir')return (strength&&(hero.hp<hero.stats.hp||hero.mp<hero.maxMp))||hasBonus;
 if(row.kind==='clear')return hero.statuses.some(s=>s.kind==='debuff'&&s.attribute===row.attribute)||hasBonus;
 if(row.kind==='clear_all')return hero.statuses.some(s=>s.kind==='debuff');
 return false;
}
export function potion(u,item,items,buffs){const row=items.find(x=>x.id===item.id);if(!row)throw Error('Unknown potion');let amount=0;if(row.kind==='heal'){amount=Math.min(u.stats.hp-u.hp,item.value);u.hp+=amount;}else if(row.kind==='mana'){amount=Math.min(u.maxMp-u.mp,item.value);u.mp+=amount;}else if(row.kind==='elixir'){
 const rate=clamp(Number(item.value||0)/100,0,1);
 const hp=Math.max(0,Math.min(u.stats.hp-u.hp,Math.ceil(u.stats.hp*rate)));
 const mp=Math.max(0,Math.min(u.maxMp-u.mp,Math.ceil(u.maxMp*rate)));
 u.hp+=hp;u.mp+=mp;amount=hp+mp;
 }else if(row.kind==='clear')u.statuses=u.statuses.filter(s=>s.kind!=='debuff'||s.attribute!==row.attribute);
 else if(row.kind==='clear_all')u.statuses=u.statuses.filter(s=>s.kind!=='debuff');
 else if(row.kind==='revive'){
  if(u.reviveArmed||u.reviveUsed||u.hp<=0)throw Error('生命の紅石はこの戦闘ですでに使用済みです');
  u.reviveArmed=true;
 }else throw Error('Potion kind');if(item.bonus){const b=buffs.find(x=>x.id===item.bonus);if(b)addStatus(u,{id:b.id,kind:'buff',attribute:row.attribute||'law',effect:b.effect,value:Number(b.value),turns:Number(b.duration)||2});}return amount;}
// An inheritor's HP change can be applied only once per recipient, even across spells.
export function applyLegacyHp(src,tgt,spell){
 if(src?.id!=='player')return '';
 const sources=Array.isArray(spell?.legacyHpSources)&&spell.legacyHpSources.length
  ?spell.legacyHpSources:[{name:'legacy:old',hp:spell?.legacyHp}];
 const self=spell.role==='support'||spell.role==='defense',unit=self?src:tgt;
 const used=new Set(unit.legacyHpApplied||[]);
 let bonus=0;
 for(const source of sources){
  const name=String(source?.name||''),hp=Math.floor(Number(source?.hp)||0);
  if(!name||!Number.isFinite(hp)||hp<=0||used.has(name))continue;
  used.add(name);bonus+=hp;
 }
 if(!bonus)return '';
 unit.legacyHpApplied=[...used];
 const oldMax=unit.stats.hp;
 unit.stats.hp=Math.max(1,oldMax+(self?bonus:-bonus));
 unit.hp=Math.min(unit.hp,unit.stats.hp);
 const changed=Math.abs(unit.stats.hp-oldMax);
 return changed?'・最大HP'+(self?'+':'-')+changed:'';
}
export function cast(src,tgt,spell,buffs,r=Math.random){
 const a=spell.attribute,B=effectivePower(src,spell),q=strength(src,spell);
 if(!ATTRS.includes(a)||!ROLES.includes(spell.role))throw Error('Bad magic');
 const legacy=applyLegacyHp(src,tgt,spell);
 if(spell.role==='attack'){
  const d=damage(src,tgt,spell,r);tgt.hp=Math.max(0,tgt.hp-d);
  return 'ダメージ '+d+legacy;
 }
 if(spell.role==='support'){
  const heal=Math.max(0,Math.min(src.stats.hp-src.hp,Math.round(B*factor(src,'heal')*factor(src,'output'))));
  src.hp+=heal;src.statuses=src.statuses.filter(x=>x.kind!=='debuff'||x.attribute!==a);
  return 'HP '+heal+'回復・'+a+'解除'+legacy;
 }
 if(spell.role==='defense'){
  const duration=statusDuration(spell);
  addStatus(src,{id:'resist_'+a,kind:'buff',attribute:a,effect:'resist',value:clamp(num('defense_resistance_gain')*q,0,num('defense_resistance_cap')),turns:duration});
  const chosen=a==='chaos'?ATTRS[roll(0,5,r)]:a,row=buffs.find(x=>x.id==='buff_'+chosen);
  if(row)addStatus(src,{id:row.id,kind:'buff',attribute:a,effect:row.effect,value:Number(row.value)*q,turns:duration});
  return a+'耐性と強化'+legacy;
 }
 const row=buffs.find(x=>x.id==='debuff_'+a);
 if(row){
  const law=status(tgt,'buff_law'),protection=law?Math.max(0,1-law.value):1;
  // Power sets the base curse; level-scaled MAG and RES are compared as a ratio.
  // This avoids weakening deep-floor debuffs solely because both sides leveled up.
  const mag=Math.max(0,Number(src.stats.mag)||0),res=Math.max(0,Number(tgt.stats.res)||0);
  const ratio=mag+res>0?clamp(2*mag/(mag+res),num('debuff_mag_res_min'),num('debuff_mag_res_max')):1;
  const targetFactor=resist(tgt,a)*protection*ratio;
  const S=debuffPowerFactor(spell);
  // Preserve the legacy burn-status multiplier in ongoing saved expeditions.
  const magnitude=row.effect==='burn'
   ?(Number(row.value)+num('burn_growth_hp_rate')*S)/num('burn_hp_rate')
   :row.effect==='soak'?Number(row.value)+num('soak_growth_rate')*S
   :row.effect==='dizzy'?Number(row.value)+num('dizzy_growth_rate')*S
   :row.effect==='output'?Number(row.value)-num('gravity_growth_rate')*S
   :Number(row.value);
  const adjusted=magnitude*targetFactor;
  const value=row.effect==='burn'?clamp(adjusted,0,num('burn_max_hp_rate')/num('burn_hp_rate'))
   :row.effect==='soak'?clamp(adjusted,0,num('soak_max_rate'))
   :row.effect==='dizzy'?clamp(adjusted,0,num('dizzy_max_rate'))
   :row.effect==='output'?clamp(adjusted,-num('gravity_max_rate'),0)
   :adjusted;
  const shockExtra=row.effect==='shock'
   ?clamp(num('shock_cooldown_extra')+Math.floor(Number(spell.power)*targetFactor/num('shock_power_step')),num('shock_cooldown_extra'),num('shock_cooldown_max_extra')):undefined;
  let sealedRoles=null;
  if(row.effect==='seal'){
   const count=Number(spell.power)*targetFactor>=num('seal_two_roles_power')?2:1;
   const pool=[...ROLES];
   sealedRoles=Array.from({length:count},()=>pool.splice(roll(0,pool.length-1,r),1)[0]);
  }
  addStatus(tgt,{id:'debuff_'+a,kind:'debuff',attribute:a,effect:row.effect,value,shockExtra,
   sealedRoles,sealedRole:sealedRoles?.[0]??null,turns:statusDuration(spell)});
 }
 return a+'弱体付与'+legacy;
}
// One fatal hit can trigger an armed life ruby; it cannot trigger again this fight.
export function reviveOnFatal(unit){
 if(unit.hp>0||!unit.reviveArmed||unit.reviveUsed)return 0;
 unit.reviveArmed=false;unit.reviveUsed=true;
 unit.hp=Math.max(1,Math.ceil(unit.stats.hp*.5));
 return unit.hp;
}
// Optional onStep is a read-only timeline of resolved actions; combat rules are unchanged.
export function round(player,enemy,pickPlayer,pickEnemy,buffs,r=Math.random,onStep){
 const used=new Set();
 const mark=(unit,check)=>{for(const s of unit.statuses)if(check(s))used.add(s);};
 const ps=prepare(player,pickPlayer,r),es=prepare(enemy,pickEnemy,r);
 for(const [unit,pick] of [[player,pickPlayer],[enemy,pickEnemy]]){
  mark(unit,s=>s.effect==='seal'||(pick>=0&&(s.effect==='shock'||s.effect==='confused')));
 }
 const actions=[{u:player,t:enemy,sp:ps,name:'自分',side:'hero'},{u:enemy,t:player,sp:es,name:'敵',side:'enemy'}],log=[];
 const snapshot=u=>({...u,statuses:u.statuses.map(x=>({...x})),cooldowns:[...u.cooldowns]});
 const publish=(a,role,attribute,message,amount=0)=>{
  if(onStep)onStep({side:a.side,role,attribute,text:message,amount,
   // Visual-only: this is not used by casting, damage, or resource calculations.
   upgradeLevel:['attack','defense','support','debuff'].includes(role)?a.sp?.upgradeLevel??0:0,
   hero:snapshot(player),enemy:snapshot(enemy)});
 };
 for(const role of ['support','defense','debuff','attack','basic']){
  for(const a of actions){
   if(a.sp.role!==role)continue;
   const oldHp=role==='support'?a.u.hp:a.t.hp;
   if(role==='debuff')mark(a.t,s=>s.id==='buff_law'||s.effect==='soak'||s.id==='resist_'+a.sp.attribute);
   let message;
   if(role==='basic'){
    // HP scaling approximates one fifth of an ordinary enemy in the recommended level band.
     // It does not adapt to the current target, so bosses keep their HP advantage.
     // Compare armor against the same base-level HP scale; otherwise
     // high-level defense growth makes ordinary attacks obsolete.
     const relativeArmor=armor(a.t)/Math.max(1,a.t.stats.hp/Math.max(1,a.t.base.hp));
     const dizzy=status(a.u,'debuff_storm');
     const missed=dizzy&&r()<clamp(dizzy.value,0,num('dizzy_max_rate'));
     const d=missed?0:Math.max(1,Math.round(num('basic_attack')*a.u.stats.hp*
      factor(a.u,'attack')*factor(a.u,'output')*factor(a.t,'incoming')*
      num('def_divisor')/(num('def_divisor')+relativeArmor)));
    a.t.hp=Math.max(0,a.t.hp-d);
    message=a.name+'：通常攻撃 '+d;
   }else message=a.name+'：'+cast(a.u,a.t,a.sp,buffs,r);
   log.push(message);
   const amount=role==='support'?a.u.hp-oldHp:oldHp-a.t.hp;
   if(role==='attack'||role==='basic'){
    mark(a.u,s=>s.effect==='dizzy');
    if(amount>0){
     mark(a.u,s=>s.effect==='attack'||s.effect==='output');
     mark(a.t,s=>s.effect==='incoming'||s.effect==='def'||
      (role==='attack'&&(s.effect==='soak'||s.id==='resist_'+a.sp.attribute)));
    }
   }else if(role==='support'&&amount>0){
    mark(a.u,s=>s.effect==='heal'||s.effect==='output');
   }
   const revived=reviveOnFatal(a.t);
   publish(a,role,a.sp.attribute,message,amount);
   if(revived){
    const revival='生命の紅石：復活！ HP '+revived;
    log.push(revival);
    publish({side:a.side==='hero'?'enemy':'hero'},'revive','law',revival,revived);
   }
  }
 }
 for(const a of actions){
  for(const s of a.u.statuses){
   if(s.effect==='burn'){
    used.add(s);
    const d=Math.max(num('status_tick_min_damage'),Math.round(a.u.stats.hp*Math.min(num('burn_max_hp_rate'),num('burn_hp_rate')*s.value)));
    const oldHp=a.u.hp;
    a.u.hp=Math.max(0,a.u.hp-d);
    const amount=oldHp-a.u.hp;
    const revived=reviveOnFatal(a.u);
    const message=a.name+'：火傷 '+d;
    log.push(message);
    publish(a,'burn',s.attribute,message,amount);
    if(revived){
     const revival='生命の紅石：復活！ HP '+revived;
     log.push(revival);
     publish(a,'revive','law',revival,revived);
    }
   }
   if(used.has(s))s.turns--;
  }
  a.u.statuses=a.u.statuses.filter(s=>s.turns>0);
  a.u.cooldowns=a.u.cooldowns.map(x=>Math.max(0,x-1));
 }
 return log;
}
// Old 10-layer full-recovery saves could contain undefined MP after
// reading hero.stats.mp (which does not exist). Repair only invalid values;
// legitimate 0 MP must remain 0.
export function repairInvalidMp(hero){
 if(!hero||Number.isFinite(hero.mp)||!Number.isFinite(hero.maxMp)||hero.maxMp<=0)return false;
 hero.mp=hero.maxMp;
 return true;
}
// Floor-scaled *multiplier* on the level-based victory MP reward.
// An ordinary victory at 100F and deeper restores 0 MP; existing
// tenth-layer checkpoints still use their separate full-recovery rules.
export const VICTORY_MP_LAYER_CURVE=Object.freeze(
 [[1,1],[10,1],[15,.815],[20,.5976],[21,.5799],[22,.547],[25,.541],[29,.53955],[30,.5395],[35,.462],[40,.406],
  [41,.387],[45,.338],[49,.317],[50,.316],[51,.30324],[52,.30102],[55,.29597],[59,.29282],[60,.2924],
  [65,.228],[70,.2244],[71,.19065],[75,.18547],[79,.18271],[80,.182],[85,.172],[89,.143],
  [90,.1288],[95,.0751],[100,0]].map(point=>Object.freeze(point)));
export function victoryMpLayerFactor(layer,policy=VICTORY_MP_LAYER_CURVE){
 const floor=Number(layer);
 if(!Number.isFinite(floor))return 1;
 if(Array.isArray(policy)&&policy.length){
  if(floor<=policy[0][0])return clamp(Number(policy[0][1]),0,1);
  for(let i=1;i<policy.length;i++){
   const [left,rate]=policy[i-1],[right,next]=policy[i];
   if(floor<=right)
    return clamp(Number(rate)+(Number(next)-Number(rate))*(floor-left)/Math.max(1,right-left),0,1);
  }
  return clamp(Number(policy.at(-1)[1]),0,1);
 }
 return 1;
}
// Bonus stays flat through layer 10, then linearly disappears at layer 20.
// From layer 20 onward the pre-existing victory recovery is unchanged.
export function earlyVictoryMpBonusRate(layer){
 const floor=Number(layer);
 return Number.isFinite(floor)?num('victory_mp_early_layer_bonus')*clamp((20-floor)/10,0,1):0;
}
export function recoverVictoryMp(hero,layer=1){
 const floor=Number(layer);
 const t=clamp((Number(hero.level)-1)/Math.max(1,num('level_max')-1),0,1);
 const middle=clamp((Number(hero.level)-40)/Math.max(1,num('level_max')-40),0,1);
 const rate=num('victory_mp_restore_rate_early')+(num('victory_mp_restore_rate_late')-num('victory_mp_restore_rate_early'))*t+
  num('victory_mp_beginner_bonus')*Math.max(0,(13-Number(hero.level))/12)-
  num('victory_mp_middle_taper')*middle*(1-middle);
 const gained=Math.max(0,Math.min(hero.maxMp-hero.mp,Math.round(hero.maxMp*(rate*victoryMpLayerFactor(floor)+earlyVictoryMpBonusRate(floor)))));
 hero.mp+=gained;
 return gained;
}
// Both combatants use the exact same authored base and level growth.
export function fromEnemy(row,level){
 const base={hp:+row.hp,mag:+row.mag,def:+row.def,res:+row.res};
 const resists=Object.fromEntries(ATTRS.map(a=>[a,+row['resist_'+a]]));
 const spells=row.spells.split('|').map(s=>{const [role,attribute,power]=s.split(':');return {role,attribute,power:+power};});
 return makeUnit(base,level,resists,spells,row.id);
}
export function validateMasters(enemies,items,collections,buffs){for(const [name,rows] of [['enemies',enemies],['items',items],['collections',collections],['buffs',buffs]]){if(!rows.length||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Invalid '+name);}for(const e of enemies)for(const a of ATTRS)if(!Number.isFinite(Number(e['resist_'+a])))throw Error('Missing resistance '+a);for(const i of items){
  if(+i.min_value>+i.max_value||!(Number(i.weight)>0))throw Error('Bad item roll');
  if(['clear','clear_all','escape','revive'].includes(i.kind)){
   if(+i.min_layer<(i.kind==='revive'?50:20)||i.tier||+i.min_value||+i.max_value)throw Error('Invalid special consumable '+i.id);
  }else if(i.kind==='elixir'){
   if(!({small:30,medium:55,large:80}[i.tier]===Number(i.min_layer))||i.min_value!==i.max_value||!({small:35,medium:65,large:100}[i.tier]===Number(i.min_value)))throw Error('Invalid elixir '+i.id);
  }else if(!['heal','mana'].includes(i.kind)||!CONSUMABLE_TIERS.includes(i.tier)||+i.min_layer!==1){
   throw Error('Bad consumable tier '+i.id);
  }
 }
 for(const tier of CONSUMABLE_TIERS)
  if(!items.some(x=>x.kind==='heal'&&x.tier===tier)||!items.some(x=>x.kind==='mana'&&x.tier===tier))throw Error('Missing consumable tier '+tier);
 for(const c of collections)if(!['common','uncommon','rare','epic','legendary'].includes(c.rarity)||!(Number(c.weight)>0))throw Error('Invalid collection');
 for(const b of enemies.filter(e=>e.boss_only==='1'))bossUniqueCollection(collections,b.id);
 return true;}
