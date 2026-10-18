import {num,level,range} from './dungeon-tuning.mjs';
import {rollCollection,bossUniqueCollection,rollConsumableTier,eligibleConsumables,CONSUMABLE_TIERS,targetClearLevel} from './dungeon-design.mjs';
export const ATTRS=['flame','bolt','aqua','storm','gravity','law','chaos'];
export const ROLES=['attack','defense','support','debuff'];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const roll=(a,b,r=Math.random)=>a+Math.floor(r()*(b-a+1));
export const capacity=level=>+levelRow(level).carry_limit;
// Raise level-up requirements steeply while keeping the authored baseline.
export const nextXp=level=>Math.ceil(Number(levelRow(level).xp_to_next)*
 Math.pow(num('xp_growth_per_10_levels'),(Number(level)-1)/10));
// Five fights at the intended level supply approximately the XP needed
// to start the following layer. Lower-level enemies have diminishing returns.
export function fightExperience(enemyLevel,playerLevel,layer){
 if(Number(playerLevel)>=num('level_max'))return 0;
 const current=targetClearLevel(Number(layer));
 const next=targetClearLevel(Number(layer)+1);
 const budget=next>current
  ?Array.from({length:next-current},(_,i)=>nextXp(current+i)).reduce((a,b)=>a+b,0)
  :nextXp(current);
 const full=Math.max(1,Math.ceil(budget/5));
 const gap=Math.max(0,Number(playerLevel)-Number(enemyLevel));
 return Math.max(1,Math.round(full*Math.pow(num('xp_overlevel_factor_per_level'),gap)));
}
export const basePower=p=>Math.round(num('power_scale')*Math.sqrt(Math.max(0,p)/num('power_divisor')));
export const mpCost=p=>num('mp_cost_base')+Math.ceil(basePower(p)/num('mp_cost_divisor'));
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
 if(['clear','escape','revive'].includes(item.kind))return 0;
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
export function dropCount(l,r=Math.random){const p=clamp(num('loot_chance_base')+num('loot_chance_per_level')*(l-1),num('loot_chance_base'),num('loot_chance_cap'));let n=num('loot_count_min');for(let i=0;i<num('loot_count_max')-num('loot_count_min');i++)if(r()<p)n++;return n;}
export function drops(items,collections,l,r=Math.random,context={}){
 const layer=context.layer??1;
 // Per-enemy rewards can be zero; five encounters average about four drops per layer.
 const rewards=Array.from({length:dropCount(l,r)},()=>{
  if(r()<num('consumable_drop_rate')){
   const tier=rollConsumableTier(layer,r);
   const x=weighted(eligibleConsumables(items,layer,tier),r);
   return {type:'use',id:x.id,value:rollPotionValue(x,layer,r),bonus:x.bonus_buff_id&&r()<Number(x.bonus_chance)?x.bonus_buff_id:null};
  }
  if(r()<num('magic_stone_drop_rate'))return {type:'stone',id:'magic_stone'};
  return {type:'collection',id:rollCollection(collections,layer,r,context.bossEnemyId??null).id};
 });
 if(context.bossEnemyId&&context.guaranteeBossCollection){
  const id=bossUniqueCollection(collections,context.bossEnemyId).id;
  const existing=rewards.findIndex(item=>item.type==='collection'&&item.id===id);
  const slot=existing>=0?existing:rewards.findIndex(item=>item.type==='collection');
  // Even an otherwise empty boss drop always contains its first-clear trophy.
  // Replace one random reward if five were rolled; avoid adding a sixth.
  if(slot>=0)rewards[slot]={type:'collection',id};
  else if(rewards.length)rewards[rewards.length-1]={type:'collection',id};
  else rewards.push({type:'collection',id});
 }
 return rewards;
}
export function experience(p,xp){p.xp+=xp;while(p.level<num('level_max')&&p.xp>=nextXp(p.level)){p.xp-=nextXp(p.level);p.level++;}if(p.level>=num('level_max'))p.xp=0;return p.level;}
export const effectivePower=(actor,spell)=>basePower(spell.power)*actor.stats.mag/num('mag_reference');
export const strength=(actor,spell)=>clamp(effectivePower(actor,spell)/num('magic_magnitude_divisor'),num('magic_magnitude_min'),num('magic_magnitude_max'));
export const status=(actor,id)=>actor.statuses.find(s=>s.id===id);
export function addStatus(actor,s){const old=status(actor,s.id);if(old&&s.id==='debuff_chaos'){Object.assign(old,s);return;}if(old){old.turns=Math.max(old.turns,s.turns);if(Math.abs(s.value)>Math.abs(old.value))old.value=s.value;return;}actor.statuses.push(s);}
export function resist(actor,attr){let r=actor.resists[attr]??1;const buff=status(actor,'resist_'+attr);const soak=status(actor,'debuff_aqua');if(buff)r*=1-buff.value*(soak?Math.max(0,1-soak.value):1);return clamp(r,num('status_min_resistance'),num('status_max_resistance'));}
export function factor(actor,effect){return clamp(actor.statuses.filter(x=>x.effect===effect).reduce((n,x)=>n*(1+x.value),1),num('modifier_min'),num('modifier_max'));}
export const armor=actor=>Math.ceil(Math.max(0,actor.stats.def+actor.statuses.filter(x=>x.effect==='def').reduce((n,x)=>n+x.value,0)));
export function damage(src,tgt,spell,r=Math.random){const dizzy=status(src,'debuff_storm');if(dizzy&&r()<clamp(dizzy.value,0,num('dizzy_max_rate')))return 0;return Math.max(0,Math.round(effectivePower(src,spell)*resist(tgt,spell.attribute)*factor(src,'attack')*factor(src,'output')*factor(tgt,'incoming')*num('def_divisor')/(num('def_divisor')+armor(tgt))));}
export function canCast(u,i){const s=u.spells[i];return Boolean(s&&u.mp>=mpCost(s.power)&&!u.cooldowns[i]&&!u.statuses.some(x=>x.effect==='seal'&&x.sealedRole===s.role));}
export const available=u=>u.spells.map((_,i)=>i).filter(i=>canCast(u,i));
export function prepare(u,i,r=Math.random){if(i===-1)return {role:'basic',attribute:'law',power:0};const confused=status(u,'debuff_chaos');if(confused){const choices=available(u);if(choices.length)i=choices[roll(0,choices.length-1,r)];u.statuses=u.statuses.filter(s=>s!==confused);}if(!canCast(u,i))throw Error('Spell unavailable');const sp=u.spells[i];u.mp-=mpCost(sp.power);u.cooldowns[i]=num('spell_cooldown');const shock=status(u,'debuff_bolt');if(shock){u.cooldowns[i]+=num('shock_cooldown_extra');u.statuses=u.statuses.filter(s=>s!==shock);}return {...sp};}
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
 return false;
}
export function potion(u,item,items,buffs){const row=items.find(x=>x.id===item.id);if(!row)throw Error('Unknown potion');let amount=0;if(row.kind==='heal'){amount=Math.min(u.stats.hp-u.hp,item.value);u.hp+=amount;}else if(row.kind==='mana'){amount=Math.min(u.maxMp-u.mp,item.value);u.mp+=amount;}else if(row.kind==='elixir'){
 const rate=clamp(Number(item.value||0)/100,0,1);
 const hp=Math.max(0,Math.min(u.stats.hp-u.hp,Math.ceil(u.stats.hp*rate)));
 const mp=Math.max(0,Math.min(u.maxMp-u.mp,Math.ceil(u.maxMp*rate)));
 u.hp+=hp;u.mp+=mp;amount=hp+mp;
 }else if(row.kind==='clear')u.statuses=u.statuses.filter(s=>s.kind!=='debuff'||s.attribute!==row.attribute);
 else if(row.kind==='revive'){
  if(u.reviveArmed||u.reviveUsed||u.hp<=0)throw Error('生命の紅石はこの戦闘ですでに使用済みです');
  u.reviveArmed=true;
 }else throw Error('Potion kind');if(item.bonus){const b=buffs.find(x=>x.id===item.bonus);if(b)addStatus(u,{id:b.id,kind:'buff',attribute:row.attribute||'law',effect:b.effect,value:Number(b.value),turns:Number(b.duration)||2});}return amount;}
export function cast(src,tgt,spell,buffs,r=Math.random){const a=spell.attribute,B=effectivePower(src,spell),q=strength(src,spell);if(!ATTRS.includes(a)||!ROLES.includes(spell.role))throw Error('Bad magic');if(spell.role==='attack'){const d=damage(src,tgt,spell,r);tgt.hp=Math.max(0,tgt.hp-d);return 'ダメージ '+d;}
 if(spell.role==='support'){const heal=Math.max(0,Math.min(src.stats.hp-src.hp,Math.round(B*factor(src,'heal')*factor(src,'output'))));src.hp+=heal;src.statuses=src.statuses.filter(x=>x.kind!=='debuff'||x.attribute!==a);return 'HP '+heal+'回復・'+a+'解除';}
 if(spell.role==='defense'){addStatus(src,{id:'resist_'+a,kind:'buff',attribute:a,effect:'resist',value:clamp(num('defense_resistance_gain')*q,0,num('defense_resistance_cap')),turns:num('resistance_buff_duration')});const chosen=a==='chaos'?ATTRS[roll(0,5,r)]:a,row=buffs.find(x=>x.id==='buff_'+chosen);if(row)addStatus(src,{id:row.id,kind:'buff',attribute:a,effect:row.effect,value:Number(row.value)*q,turns:Number(row.duration)});return a+'耐性と強化';}
 const chosen=a==='chaos'?ATTRS[roll(0,5,r)]:a,row=buffs.find(x=>x.id==='debuff_'+chosen);if(row){const law=status(tgt,'buff_law');const protection=law?Math.max(0,1-law.value):1;const power=q*resist(tgt,a)*protection*num('debuff_res_base')/(num('debuff_res_base')+tgt.stats.res);addStatus(tgt,{id:'debuff_'+a,kind:'debuff',attribute:a,effect:row.effect,value:Number(row.value)*power,turns:clamp(Math.round(Number(row.duration)*power),num('debuff_min_duration'),num('debuff_max_duration')),sealedRole:row.effect==='seal'?ROLES[roll(0,3,r)]:null});}return a+'弱体付与';}
// One fatal hit can trigger an armed life ruby; it cannot trigger again this fight.
export function reviveOnFatal(unit){
 if(unit.hp>0||!unit.reviveArmed||unit.reviveUsed)return 0;
 unit.reviveArmed=false;unit.reviveUsed=true;
 unit.hp=Math.max(1,Math.ceil(unit.stats.hp*.5));
 return unit.hp;
}
// Optional onStep is a read-only timeline of resolved actions; combat rules are unchanged.
export function round(player,enemy,pickPlayer,pickEnemy,buffs,r=Math.random,onStep){
 const ps=prepare(player,pickPlayer,r),es=prepare(enemy,pickEnemy,r);
 const actions=[{u:player,t:enemy,sp:ps,name:'自分',side:'hero'},{u:enemy,t:player,sp:es,name:'敵',side:'enemy'}],log=[];
 const snapshot=u=>({...u,statuses:u.statuses.map(x=>({...x})),cooldowns:[...u.cooldowns]});
 const publish=(a,role,attribute,message,amount=0)=>{
  if(onStep)onStep({side:a.side,role,attribute,text:message,amount,
   hero:snapshot(player),enemy:snapshot(enemy)});
 };
 for(const role of ['support','defense','debuff','attack','basic']){
  for(const a of actions){
   if(a.sp.role!==role)continue;
   const oldHp=role==='support'?a.u.hp:a.t.hp;
   let message;
   if(role==='basic'){
    const d=Math.max(1,Math.round(num('basic_attack')*a.u.stats.mag/num('mag_reference')*num('def_divisor')/(num('def_divisor')+armor(a.t))));
    a.t.hp=Math.max(0,a.t.hp-d);
    message=a.name+'：通常攻撃 '+d;
   }else message=a.name+'：'+cast(a.u,a.t,a.sp,buffs,r);
   log.push(message);
   const amount=role==='support'?a.u.hp-oldHp:oldHp-a.t.hp;
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
    const d=Math.max(num('status_tick_min_damage'),Math.round(a.u.stats.hp*num('burn_hp_rate')*s.value));
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
   s.turns--;
  }
  a.u.statuses=a.u.statuses.filter(s=>s.turns>0);
  a.u.cooldowns=a.u.cooldowns.map(x=>Math.max(0,x-1));
 }
 return log;
}
export function enemyScaling(level){
 const t=clamp((Number(level)-1)/(num('level_max')-1),0,1);
 return {hp:num('enemy_hp_scale_early')+(num('enemy_hp_scale_late')-num('enemy_hp_scale_early'))*t,
  mag:num('enemy_mag_scale_early')+(num('enemy_mag_scale_late')-num('enemy_mag_scale_early'))*t};
}
// Old 10-layer full-recovery saves could contain undefined MP after
// reading hero.stats.mp (which does not exist). Repair only invalid values;
// legitimate 0 MP must remain 0.
export function repairInvalidMp(hero){
 if(!hero||Number.isFinite(hero.mp)||!Number.isFinite(hero.maxMp)||hero.maxMp<=0)return false;
 hero.mp=hero.maxMp;
 return true;
}
export function recoverVictoryMp(hero){
 const t=clamp((Number(hero.level)-1)/Math.max(1,num('level_max')-1),0,1);
 const rate=num('victory_mp_restore_rate_early')+(num('victory_mp_restore_rate_late')-num('victory_mp_restore_rate_early'))*t+
  num('victory_mp_beginner_bonus')*Math.max(0,(13-Number(hero.level))/12);
 const gained=Math.max(0,Math.min(hero.maxMp-hero.mp,Math.round(hero.maxMp*rate)));
 hero.mp+=gained;
 return gained;
}
export function fromEnemy(row,level){
 const scale=enemyScaling(level);
 const b={hp:Math.max(1,Math.round(+row.hp*scale.hp)),mag:Math.max(1,Math.round(+row.mag*scale.mag)),def:+row.def,res:+row.res};const resists=Object.fromEntries(ATTRS.map(a=>[a,+row['resist_'+a]]));const spells=row.spells.split('|').map(s=>{const [role,attribute,power]=s.split(':');return {role,attribute,power:+power};});return makeUnit(b,level,resists,spells,row.id);}
export function validateMasters(enemies,items,collections,buffs){for(const [name,rows] of [['enemies',enemies],['items',items],['collections',collections],['buffs',buffs]]){if(!rows.length||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Invalid '+name);}for(const e of enemies)for(const a of ATTRS)if(!Number.isFinite(Number(e['resist_'+a])))throw Error('Missing resistance '+a);for(const i of items){
  if(+i.min_value>+i.max_value||!(Number(i.weight)>0))throw Error('Bad item roll');
  if(['clear','escape','revive'].includes(i.kind)){
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
