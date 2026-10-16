import {num,level,range} from './dungeon-tuning.mjs';
export const ATTRS=['flame','bolt','aqua','storm','gravity','law','chaos'];
export const ROLES=['attack','defense','support','debuff'];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const roll=(a,b,r=Math.random)=>a+Math.floor(r()*(b-a+1));
export const capacity=level=>+levelRow(level).carry_limit;
export const nextXp=level=>+levelRow(level).xp_to_next;
export const basePower=p=>Math.round(num('power_scale')*Math.sqrt(Math.max(0,p)/num('power_divisor')));
export const mpCost=p=>num('mp_cost_base')+Math.ceil(basePower(p)/num('mp_cost_divisor'));
const levelRow=l=>level(l);
const growthKeys=['hp','mag','def','res'];
export const startingBase=(r=Math.random)=>Object.fromEntries(growthKeys.map(k=>[k,roll(...range(k),r)]));
export function stats(base,level){const record=levelRow(level);return Object.fromEntries(growthKeys.map(k=>[k,Math.round(base[k]*Number(record[k+'_multiplier']))]));}
export function makeUnit(base,level,resists={},spells=[],id='unit'){
 const s=stats(base,level);return {id,level,base,stats:s,hp:s.hp,maxMp:num('mp_base')+num('mp_per_mag')*s.mag,mp:num('mp_base')+num('mp_per_mag')*s.mag,spells:spells.map(x=>x?({...x}):null),cooldowns:spells.map(()=>0),statuses:[],resists:Object.fromEntries(ATTRS.map(a=>[a,Number(resists[a]??num('base_resistance'))]))};
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
export function dropCount(l,r=Math.random){const p=clamp(num('loot_chance_base')+num('loot_chance_per_level')*(l-1),num('loot_chance_base'),num('loot_chance_cap'));let n=num('loot_count_min');for(let i=0;i<num('loot_count_max')-num('loot_count_min');i++)if(r()<p)n++;return n;}
export function drops(items,collections,l,r=Math.random){return Array.from({length:dropCount(l,r)},()=>{if(r()<num('consumable_drop_rate')){const x=weighted(items,r);return {type:'use',id:x.id,value:roll(Number(x.min_value),Number(x.max_value),r),bonus:x.bonus_buff_id&&r()<Number(x.bonus_chance)?x.bonus_buff_id:null};}return {type:'collection',id:weighted(collections,r).id};});}
export function experience(p,xp){p.xp+=xp;while(p.level<num('level_max')&&p.xp>=nextXp(p.level)){p.xp-=nextXp(p.level);p.level++;}return p.level;}
export const effectivePower=(actor,spell)=>basePower(spell.power)*actor.stats.mag/num('mag_reference');
export const strength=(actor,spell)=>clamp(effectivePower(actor,spell)/num('magic_magnitude_divisor'),num('magic_magnitude_min'),num('magic_magnitude_max'));
export const status=(actor,id)=>actor.statuses.find(s=>s.id===id);
export function addStatus(actor,s){const old=status(actor,s.id);if(old){old.turns=Math.max(old.turns,s.turns);if(Math.abs(s.value)>Math.abs(old.value))old.value=s.value;return;}actor.statuses.push(s);}
export function resist(actor,attr){let r=actor.resists[attr]??1;const buff=status(actor,'resist_'+attr);const soak=status(actor,'debuff_aqua');if(buff)r*=1-buff.value*(soak?Math.max(0,1-soak.value):1);return clamp(r,num('status_min_resistance'),num('status_max_resistance'));}
export function factor(actor,effect){return clamp(actor.statuses.filter(x=>x.effect===effect).reduce((n,x)=>n*(1+x.value),1),num('modifier_min'),num('modifier_max'));}
export const armor=actor=>Math.max(0,actor.stats.def+actor.statuses.filter(x=>x.effect==='def').reduce((n,x)=>n+x.value,0));
export function damage(src,tgt,spell,r=Math.random){const dizzy=status(src,'debuff_storm');if(dizzy&&r()<clamp(dizzy.value,0,num('dizzy_max_rate')))return 0;return Math.max(0,Math.round(effectivePower(src,spell)*resist(tgt,spell.attribute)*factor(src,'attack')*factor(src,'output')*factor(tgt,'incoming')*num('def_divisor')/(num('def_divisor')+armor(tgt))));}
export function canCast(u,i){const s=u.spells[i];return Boolean(s&&u.mp>=mpCost(s.power)&&!u.cooldowns[i]&&!u.statuses.some(x=>x.effect==='seal'&&x.sealedRole===s.role));}
export const available=u=>u.spells.map((_,i)=>i).filter(i=>canCast(u,i));
export function prepare(u,i,r=Math.random){if(i===-1)return {role:'basic',attribute:'law',power:0};const confused=status(u,'debuff_chaos');if(confused){const choices=available(u);if(choices.length)i=choices[roll(0,choices.length-1,r)];u.statuses=u.statuses.filter(s=>s!==confused);}if(!canCast(u,i))throw Error('Spell unavailable');const sp=u.spells[i];u.mp-=mpCost(sp.power);u.cooldowns[i]=num('spell_cooldown');const shock=status(u,'debuff_bolt');if(shock){u.cooldowns[i]+=num('shock_cooldown_extra');u.statuses=u.statuses.filter(s=>s!==shock);}return {...sp};}
export function potion(u,item,items,buffs){const row=items.find(x=>x.id===item.id);if(!row)throw Error('Unknown potion');let amount=0;if(row.kind==='heal'){amount=Math.min(u.stats.hp-u.hp,item.value);u.hp+=amount;}else if(row.kind==='mana'){amount=Math.min(u.maxMp-u.mp,item.value);u.mp+=amount;}else if(row.kind==='clear')u.statuses=u.statuses.filter(s=>s.kind!=='debuff'||s.attribute!==row.attribute);else throw Error('Potion kind');if(item.bonus){const b=buffs.find(x=>x.id===item.bonus);if(b)addStatus(u,{id:b.id,kind:'buff',attribute:row.attribute||'law',effect:b.effect,value:Number(b.value),turns:Number(b.duration)||2});}return amount;}
export function cast(src,tgt,spell,buffs,r=Math.random){const a=spell.attribute,B=effectivePower(src,spell),q=strength(src,spell);if(!ATTRS.includes(a)||!ROLES.includes(spell.role))throw Error('Bad magic');if(spell.role==='attack'){const d=damage(src,tgt,spell,r);tgt.hp=Math.max(0,tgt.hp-d);return 'ダメージ '+d;}
 if(spell.role==='support'){const heal=Math.max(0,Math.min(src.stats.hp-src.hp,Math.round(B*factor(src,'heal')*factor(src,'output'))));src.hp+=heal;src.statuses=src.statuses.filter(x=>x.kind!=='debuff'||x.attribute!==a);return 'HP '+heal+'回復・'+a+'解除';}
 if(spell.role==='defense'){addStatus(src,{id:'resist_'+a,kind:'buff',attribute:a,effect:'resist',value:clamp(num('defense_resistance_gain')*q,0,num('defense_resistance_cap')),turns:num('resistance_buff_duration')});const chosen=a==='chaos'?ATTRS[roll(0,5,r)]:a,row=buffs.find(x=>x.id==='buff_'+chosen);if(row)addStatus(src,{id:row.id,kind:'buff',attribute:a,effect:row.effect,value:Number(row.value)*q,turns:Number(row.duration)});return a+'耐性と強化';}
 const chosen=a==='chaos'?ATTRS[roll(0,5,r)]:a,row=buffs.find(x=>x.id==='debuff_'+chosen);if(row){const law=status(tgt,'buff_law');const protection=law?Math.max(0,1-law.value):1;const power=q*resist(tgt,a)*protection*num('debuff_res_base')/(num('debuff_res_base')+tgt.stats.res);addStatus(tgt,{id:'debuff_'+a,kind:'debuff',attribute:a,effect:row.effect,value:Number(row.value)*power,turns:Number(row.duration),sealedRole:row.effect==='seal'?ROLES[roll(0,3,r)]:null});}return a+'弱体付与';}
export function round(player,enemy,pickPlayer,pickEnemy,buffs,r=Math.random){const ps=prepare(player,pickPlayer,r),es=prepare(enemy,pickEnemy,r),actions=[{u:player,t:enemy,sp:ps,name:'自分'},{u:enemy,t:player,sp:es,name:'敵'}],log=[];for(const role of ['support','defense','debuff','attack','basic'])for(const a of actions){if(a.sp.role!==role)continue;if(role==='basic'){const d=Math.max(1,Math.round(num('basic_attack')*a.u.stats.mag/num('mag_reference')*num('def_divisor')/(num('def_divisor')+armor(a.t))));a.t.hp=Math.max(0,a.t.hp-d);log.push(a.name+'：通常攻撃 '+d);}else log.push(a.name+'：'+cast(a.u,a.t,a.sp,buffs,r));}
 for(const a of actions){for(const s of a.u.statuses){if(s.effect==='burn'){const d=Math.max(num('status_tick_min_damage'),Math.round(a.u.stats.hp*num('burn_hp_rate')*s.value));a.u.hp=Math.max(0,a.u.hp-d);log.push(a.name+'：火傷 '+d);}s.turns--;}a.u.statuses=a.u.statuses.filter(s=>s.turns>0);a.u.cooldowns=a.u.cooldowns.map(x=>Math.max(0,x-1));}return log;}
export function fromEnemy(row,level){const b={hp:+row.hp,mag:+row.mag,def:+row.def,res:+row.res};const resists=Object.fromEntries(ATTRS.map(a=>[a,+row['resist_'+a]]));const spells=row.spells.split('|').map(s=>{const [role,attribute,power]=s.split(':');return {role,attribute,power:+power};});return makeUnit(b,level,resists,spells,row.id);}
export function validateMasters(enemies,items,collections,buffs){for(const [name,rows] of [['enemies',enemies],['items',items],['collections',collections],['buffs',buffs]]){if(!rows.length||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Invalid '+name);}for(const e of enemies)for(const a of ATTRS)if(!Number.isFinite(Number(e['resist_'+a])))throw Error('Missing resistance '+a);for(const i of items)if(+i.min_value>+i.max_value)throw Error('Bad item roll');return true;}
