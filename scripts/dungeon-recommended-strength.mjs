// Formula-only journey strength ledger. It uses the same authored ten floors and
// fifty enemy records for a real owner and the recommended fixed deck. The
// local actors are disposable formula inputs; this is not a battle or a win.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {referenceSpells} from './dungeon-fixed-deck-reference.mjs';
import {FIXED_CARRY,journeyItemAllowed,journeySpellAllowed} from './dungeon-test-contract.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),enemies:csv('enemies'),
 buffs:csv('buffs'),collections:csv('collections')};
configure(data);
const goals=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
const ACTION_LIMIT=80;

// round() exposes the resolved combat line on each existing event. event.amount
// is post-clamp HP loss; the line preserves the resolved value when that damage
// exceeds remaining HP, so the ledger can stay read-only with respect to core.
function incomingDamageFromEvent(event){
 const pattern=event.role==='attack'?/ダメージ\s+(\d+)/:
  event.role==='basic'?/通常攻撃\s+(\d+)/:
  event.role==='burn'?/火傷\s+(\d+)/:null;
 const match=pattern&&event.text?.match(pattern);
 if(!match)throw Error('Missing resolved incoming damage in combat event: '+event.role);
 return Number(match[1]);
}

const deterministic=()=>.5;
const tickCooldowns=unit=>{unit.cooldowns=unit.cooldowns.map(value=>Math.max(0,value-1));};
const rngFor=seed=>()=>{
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 return seed/4294967296;
};

function makeHero(snapshot,level,circles){
 return G.makeUnit(snapshot.playerBase,level,{},circles.map(c=>({role:c.role,
  attribute:c.attribute,power:c.power,basePower:c.basePower,
  upgradeLevel:c.upgradeLevel??c.upgrades??0})),'hero');
}

function selectHeroAction(hero,enemy,layer,unlocked){
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=layer<=10?undefined:ids.find(index=>hero.spells[index]?.role==='support'&&
  journeySpellAllowed(layer,unlocked,'support'));
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offense=ids.filter(index=>hero.spells[index]?.role==='attack')
  .sort((a,b)=>{
   const score=index=>G.effectivePower(hero,hero.spells[index])*
    G.resist(enemy,hero.spells[index].attribute);
   return score(b)-score(a)||a-b;
  })[0];
 if(offense!==undefined)return offense;
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}

function fixedReferenceCarry(from,level,rows){
 const [cleanserCount,lunaCount]=FIXED_CARRY[from]??[];
 assert.ok(Number.isInteger(cleanserCount),'fixed reference inventory exists for band '+from);
 if(cleanserCount+lunaCount===0)return [];
 const capacity=G.capacity(level),frequency=new Map();
 for(const row of rows)for(const spell of row.enemyRow.spells.split('|')
  .filter(value=>value.startsWith('debuff:'))){
  const attribute=spell.split(':')[1];
  frequency.set(attribute,(frequency.get(attribute)||0)+1);
 }
 // Match the existing journey pack policy: ties keep first-authored enemy order.
 const attributes=[...frequency].sort((a,b)=>b[1]-a[1])
  .map(([attribute])=>attribute);
 const ids=Array.from({length:lunaCount},()=> 'luna_stone');
 const allocated=new Map();
 for(const attribute of attributes){
  if(ids.length>=capacity)break;
  allocated.set(attribute,1);ids.push('clear_'+attribute);
 }
 while(ids.length<capacity){
  const attribute=[...attributes].sort((a,b)=>
   frequency.get(b)/(allocated.get(b)+1)-frequency.get(a)/(allocated.get(a)+1))[0];
  assert.ok(attribute,'fixed carry capacity is supplied by cleansers');
  allocated.set(attribute,allocated.get(attribute)+1);ids.push('clear_'+attribute);
 }
 assert.equal(ids.length,cleanserCount+lunaCount,'fixed benchmark carry capacity');
 for(const id of ids){
  const item=data.items.find(row=>row.id===id);
  assert.ok(item&&Number(item.min_layer)<=from-1,
   'fixed benchmark stock must be available before the band: '+id);
 }
 return ids.map((id,index)=>({id,value:0,bonus:null,
  instanceId:'fixed-reference-'+from+'-'+index}));
}

function applyItem(hero,carry,item,used,kindFilter,from,to){
 const row=data.items.find(x=>x.id===item.id);
 if(!row||!kindFilter.includes(row.kind)||
   !Array.from({length:to-from+1},(_,i)=>from+i)
    .some(layer=>journeyItemAllowed(layer,row.kind))||
   !G.canUseBattleItem(hero,item,data.items,data.buffs))return null;
 const beforeHp=hero.hp,beforeMp=hero.mp;
 G.potion(hero,{...item},data.items,data.buffs);
 const effect={itemId:item.id,instanceId:item.instanceId,kind:row.kind,
  healing:hero.hp-beforeHp,mpRestored:hero.mp-beforeMp};
 carry.splice(carry.findIndex(x=>x.instanceId===item.instanceId),1);
 used.push(effect);
 return effect;
}

function targetRows(from,to){
 const rows=[];
 for(let layer=from;layer<=to;layer++)for(let slot=0;slot<5;slot++){
  const fight=(layer-1)*5+slot+1;
  const enemyRow=data.enemies[(layer-1)*5+slot],floor=data.floors[fight-1];
  assert.ok(enemyRow&&floor,'all fifty authored enemy/floor rows must exist');
  rows.push({layer,fight,id:enemyRow.id,enemyRow,enemyLevel:Number(floor.enemy_level)});
 }
 assert.equal(rows.length,50);
 assert.equal(new Set(rows.map(x=>x.id)).size,50);
 return rows;
}

function simulateAttackPath(snapshot,level,circles,rows,from,to,{carryItems=[],seed=17011}={}){
 const hero=makeHero(snapshot,level,circles);
 const carry=carryItems.map(item=>({...item})),itemUses=[];
 const random=rngFor(seed),unlocked=snapshot.bankedBestLayer>=2;
 const floors=Array.from({length:to-from+1},(_,i)=>({layer:from+i,enemies:[],
  attackActions:0,supportActions:0,totalActions:0,recoverySlack:0,attackMp:0,damageDealt:0,damageTaken:0,enemyMpSpent:0,
  damageTakenToHp:0,
  unavailableAttackActions:0,infeasibleEnemies:[]}));
 let attackActions=0,basicAttackActions=0,attackMp=0,damageDealt=0,damageTaken=0,damageTakenToHp=0;
 let enemyMpSpent=0,victoryRecovery=0,completedEnemies=0,targetsProcessed=0,
  death=false,totalActions=0;
 const enemyActionsByRole={};
 let shadowHpFloor=hero.hp,hpDepletedAtAction=null;
 let survivalHealing=0,supportMp=0,supportActions=0;
 const recoveryByEnemy=[];
 for(const row of rows){
  targetsProcessed++;
  const enemy=G.fromEnemy(row.enemyRow,row.enemyLevel),floor=floors[row.layer-from];
  floor.enemies.push(row.id);
  let dealt=0,actions=0,attacks=0,supports=0,enemyMp=0,floorTaken=0,
   floorHpDamage=0,floorMp=0;
  let floorSupportHealing=0;
  while(enemy.hp>0&&actions<ACTION_LIMIT){
   // Carry effects are applied through the same item rules as a real owner.
   // Cleansing is resolved before the action; it does not invent HP or MP.
   if(row.layer>=6){
    const debuffs=hero.statuses.filter(status=>status.kind==='debuff');
    if(debuffs.length){
     const specific=carry.find(item=>item.id==='clear_'+debuffs[0].attribute&&
      applyItemPreview(hero,item,['clear'],row.layer,row.layer));
     const broad=carry.find(item=>item.id==='luna_stone'&&
      applyItemPreview(hero,item,['clear_all'],row.layer,row.layer));
     const cleanser=specific??broad;
     if(cleanser)applyItem(hero,carry,cleanser,itemUses,
      [cleanser.id==='luna_stone'?'clear_all':'clear'],row.layer,row.layer);
    }
   }
   const legalAttack=G.available(hero).some(index=>hero.spells[index]?.role==='attack');
   if(!legalAttack){
    const manaItem=carry.find(item=>{
     const kind=data.items.find(x=>x.id===item.id)?.kind;
     return applyItemPreview(hero,item,['mana','elixir'],row.layer,row.layer);
    });
    if(manaItem)applyItem(hero,carry,manaItem,itemUses,['mana','elixir'],row.layer,row.layer);
   }
   const heroPick=selectHeroAction(hero,enemy,row.layer,unlocked);
   const enemyPick=G.chooseEnemySpell(enemy,random);
   const heroMpBefore=hero.mp,enemyMpBefore=enemy.mp;
   const events=[],observer=event=>events.push(event);observer.metricsOnly=true;
   G.round(hero,enemy,heroPick,enemyPick,data.buffs,random,observer);
   actions++;
   totalActions++;
   const playerRoles=new Set(events.filter(event=>event.side==='hero').map(event=>event.role));
   for(const event of events.filter(event=>event.side==='enemy'&&
    ['attack','basic','defense','support','debuff'].includes(event.role)))
    enemyActionsByRole[event.role]=(enemyActionsByRole[event.role]||0)+1;
   if(playerRoles.has('attack'))attacks++;
   if(playerRoles.has('basic')){
    floor.unavailableAttackActions++;basicAttackActions++;
   }
   if(playerRoles.has('support')){
    supports++;supportActions++;
    const healed=events.filter(event=>event.side==='hero'&&event.role==='support')
     .reduce((sum,event)=>sum+event.amount,0);
    survivalHealing+=healed;floorSupportHealing+=healed;
   }
   dealt+=events.filter(event=>event.side==='hero'&&
    ['attack','basic'].includes(event.role)).reduce((sum,event)=>sum+event.amount,0);
   const incoming=events.filter(event=>event.side==='enemy'&&
    ['attack','basic','burn'].includes(event.role));
   floorTaken+=incoming.reduce((sum,event)=>sum+incomingDamageFromEvent(event),0);
   floorHpDamage+=incoming.reduce((sum,event)=>sum+event.amount,0);
   enemyMp+=enemyMpBefore-enemy.mp;
   const spent=heroMpBefore-hero.mp;
   if(playerRoles.has('attack')){floorMp+=spent;attackMp+=spent;}
   if(playerRoles.has('support')){supportMp+=spent;}
   if(hero.hp<=0){death=true;hpDepletedAtAction??=totalActions;}
   shadowHpFloor=Math.min(shadowHpFloor,hero.hp);
  }
  damageTaken+=floorTaken;
  damageTakenToHp+=floorHpDamage;
  damageDealt+=dealt;
  floor.attackActions+=attacks;floor.supportActions+=supports;
  floor.totalActions+=actions;floor.attackMp+=floorMp;
  floor.recoverySlack+=Math.max(0,ACTION_LIMIT-actions);
  recoveryByEnemy.push({fight:row.fight,id:row.id,layer:row.layer,
   actions:Math.max(0,ACTION_LIMIT-actions)});
  floor.damageDealt+=dealt;floor.healing=floorSupportHealing;
  // Per-enemy deltas avoid averaging and preserve turn-level enemy resources.
  floor.damageTaken+=floorTaken;
  floor.damageTakenToHp+=floorHpDamage;
  floor.enemyMpSpent+=enemyMp;
  attackActions+=attacks;enemyMpSpent+=enemyMp;
  if(enemy.hp>0){
   floor.infeasibleEnemies.push({id:row.id,actions,limit:ACTION_LIMIT,
    remainingHp:enemy.hp,method:actions>=ACTION_LIMIT?'ACTION_LIMIT':'NO_DAMAGE_ACTION'});
   continue;
  }
  completedEnemies++;
  hero.statuses=[];
  hero.cooldowns=hero.cooldowns.map(()=>0);
  victoryRecovery+=G.recoverVictoryMp(hero,row.layer);
  // Victory MP is counted only after this local formula path killed the
  // enemy. No later fight or reward is treated as a real result.
 }
 // Attack MP is the sum of actual G.prepare costs. Victory MP is tracked as
 // supply, never subtracted from gross spending.
 const numericTargetsCovered=targetsProcessed===rows.length;
 return {hero,carry,itemUses,floors,attackActions,basicAttackActions,attackMp,damageDealt,damageTaken,
  damageTakenToHp,
  enemyMpSpent,victoryRecovery,completedEnemies,targetsProcessed,
  numericTargetsCovered,death,
  enemyActionsByRole,
  shadowHpFloor,hpDepletedAtAction,level:hero.level,
  survivalHealing,supportMp,supportActions,
  totalActions,recoveryByEnemy,
  remainingMp:hero.mp,remainingHp:hero.hp,maxHp:hero.stats.hp,maxMp:hero.maxMp};
}

function applyItemPreview(hero,item,kinds,from,to){
 const row=data.items.find(x=>x.id===item.id);
 return Boolean(row&&kinds.includes(row.kind)&&
  Array.from({length:to-from+1},(_,i)=>from+i)
   .some(layer=>journeyItemAllowed(layer,row.kind))&&
  G.canUseBattleItem(hero,item,data.items,data.buffs));
}

function recoverWithItems(hero,carry,needed,from,to,used){
 let remaining=Math.max(0,needed),healing=0,mpRestored=0;
 hero.hp=0;
 const candidates=carry.filter(item=>applyItemPreview(hero,item,['heal','elixir'],from,to))
  .map(item=>({item,rank:data.items.find(x=>x.id===item.id)?.kind==='elixir'?1:0}))
  .sort((a,b)=>b.rank-a.rank);
 for(const {item} of candidates){
  if(remaining<=0)break;
  const row=data.items.find(x=>x.id===item.id);
  if(!row||!['heal','elixir'].includes(row.kind)||
   !G.canUseBattleItem(hero,item,data.items,data.buffs))continue;
  const beforeHp=hero.hp,beforeMp=hero.mp;
  G.potion(hero,{...item},data.items,data.buffs);
  const healed=hero.hp-beforeHp,mp=hero.mp-beforeMp;
  if(healed<=0&&mp<=0)continue;
  carry.splice(carry.findIndex(x=>x.instanceId===item.instanceId),1);
  used.push({itemId:item.id,instanceId:item.instanceId,kind:row.kind,
   healing:healed,mpRestored:mp});
  healing+=healed;mpRestored+=mp;remaining=Math.max(0,remaining-healed);
 }
 return {healing,mpRestored,remaining};
}

function supportRecovery(hero,snapshot,remaining,carry,usedItems,recoveryByEnemy){
 if(remaining<=0)return {possible:true,casts:0,mp:0,healing:0,incoming:0,
  funded:true,unfundedMp:0,actions:0,reason:null,items:[],spellUses:[],remaining:0};
 const unlocked=snapshot.bankedBestLayer>=2;
 const items=[];
 let casts=0,mp=0,healing=0,actions=0,cooldownWaits=0,unfundedMp=0;
 const spellUses=[];
 hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
 let reason=null;
 for(const encounter of recoveryByEnemy){
  if(remaining<=0)break;
  if(!journeySpellAllowed(encounter.layer,unlocked,'support'))continue;
  hero.cooldowns=hero.cooldowns.map(()=>0);
  for(let slot=0;slot<encounter.actions&&remaining>0;slot++){
   hero.hp=0;
   const legalSupport=hero.spells.map((spell,index)=>({spell,index})).filter(({spell,index})=>
    spell?.role==='support'&&!hero.cooldowns[index]&&!G.isSpellSealed(hero,spell));
   const candidates=legalSupport.map(({index})=>{
     const cost=G.spellMpCost(hero.spells[index]);
     const clone={...hero,statuses:hero.statuses.map(status=>({...status})),
      cooldowns:[...hero.cooldowns],spells:hero.spells.map(spell=>({...spell})),
      mp:Math.max(hero.mp,cost)};
     const beforeMp=clone.mp,prepared=G.prepare(clone,index,deterministic);
     const beforeHp=clone.hp;G.cast(clone,clone,prepared,data.buffs,deterministic);
     return {index,healing:clone.hp-beforeHp,mp:beforeMp-clone.mp,
      efficiency:(clone.hp-beforeHp)/Math.max(1,beforeMp-clone.mp)};
   }).filter(choice=>choice.healing>0)
    .sort((a,b)=>b.efficiency-a.efficiency||b.healing-a.healing||a.index-b.index);
   if(!candidates.length){
    const mana=carry.find(item=>applyItemPreview(hero,item,['mana','elixir'],
     encounter.layer,encounter.layer));
    if(mana){
     const effect=applyItem(hero,carry,mana,usedItems,['mana','elixir'],
      encounter.layer,encounter.layer);
     if(effect){items.push(effect);healing+=effect.healing;
      remaining=Math.max(0,remaining-effect.healing);continue;}
    }
    const coolingSupport=hero.spells.some((spell,index)=>spell?.role==='support'&&
     !G.isSpellSealed(hero,spell)&&hero.cooldowns[index]>0&&
     journeySpellAllowed(encounter.layer,unlocked,'support'));
    if(coolingSupport){
     tickCooldowns(hero);actions++;cooldownWaits++;continue;
    }
    if(hero.spells.some(spell=>spell?.role==='support'))reason='NO_AFFORDABLE_SUPPORT_RECOVERY';
    else reason='NO_SUPPORT_CIRCLE';
    break;
   }
   const pick=candidates[0],cost=pick.mp;
   if(hero.mp<cost){
    const mana=carry.find(item=>applyItemPreview(hero,item,['mana','elixir'],
     encounter.layer,encounter.layer));
    if(mana){
     const effect=applyItem(hero,carry,mana,usedItems,['mana','elixir'],
      encounter.layer,encounter.layer);
     if(effect){items.push(effect);healing+=effect.healing;
      remaining=Math.max(0,remaining-effect.healing);}
    }
    if(remaining<=0)break;
   }
   const beforeMp=hero.mp;
   const clone={...hero,statuses:hero.statuses.map(status=>({...status})),
    cooldowns:[...hero.cooldowns],spells:hero.spells.map(spell=>({...spell})),
    mp:Math.max(hero.mp,cost)};
   const beforeHp=clone.hp,prepared=G.prepare(clone,pick.index,deterministic);
   G.cast(clone,clone,prepared,data.buffs,deterministic);
   const healed=clone.hp-beforeHp,spent=G.spellMpCost(prepared);
   if(beforeMp>=spent)hero.mp=beforeMp-spent;
   else{unfundedMp+=spent-beforeMp;hero.mp=0;}
   hero.cooldowns[pick.index]=clone.cooldowns[pick.index];
   healing+=healed;mp+=spent;remaining=Math.max(0,remaining-healed);
   actions++;casts++;
   spellUses.push({fight:encounter.fight,circle:pick.index,mp:spent,healing:healed});
   tickCooldowns(hero);
  }
  if(reason)break;
 }
 if(remaining>0&&!reason)reason=actions>=recoveryByEnemy.reduce((sum,row)=>sum+row.actions,0)
  ?'RECOVERY_ACTION_LIMIT':'RECOVERY_STOCK_INSUFFICIENT';
 return {possible:remaining<=0,funded:unfundedMp<=1e-8,unfundedMp,
  casts,actions,cooldownWaits,mp,healing,incoming:0,
  reason,items,spellUses,remaining};
}

function evaluateLoadout(snapshot,level,circles,rows,from,to,{carryItems=[],seed=17011}={}){
 return simulateAttackPath(snapshot,level,circles,rows,from,to,{carryItems,seed});
}

export function recommendedReferenceCarry(bandIndex){
 assert.ok(Number.isInteger(bandIndex)&&bandIndex>=0&&bandIndex<goals.bands.length);
 const {from,to}=goals.bands[bandIndex],level=targetClearLevel(to);
 return fixedReferenceCarry(from,level,targetRows(from,to));
}

function referenceFor(bandIndex,seedIndex,snapshot){
 const circles=referenceSpells[bandIndex][seedIndex];
 const level=targetClearLevel(goals.bands[bandIndex].to);
 const carry=fixedReferenceCarry(goals.bands[bandIndex].from,level,
  targetRows(goals.bands[bandIndex].from,goals.bands[bandIndex].to));
 return {level,circles,carry};
}

export function assessRecommendedStrength(snapshot,bandIndex,seedIndex){
 assert.ok(Number.isInteger(bandIndex)&&bandIndex>=0&&bandIndex<goals.bands.length);
 assert.ok(Number.isInteger(seedIndex)&&seedIndex>=0&&seedIndex<goals.strictSamples);
 assert.ok(snapshot&&Number.isInteger(snapshot.level)&&snapshot.level>=1);
 assert.ok(snapshot.playerBase&&Array.isArray(snapshot.circles)&&snapshot.circles.length===5);
 assert.ok(Array.isArray(snapshot.carry));
 assert.ok(snapshot.carry.length<=G.capacity(snapshot.level),'real carrying capacity applies');
 assert.equal(new Set(snapshot.carry.map(x=>x.instanceId)).size,snapshot.carry.length,
  'carried stock must be actual unique instances');
 const {from,to}=goals.bands[bandIndex],rows=targetRows(from,to);
 const baseline=referenceFor(bandIndex,seedIndex,snapshot);
 const seed=17011+13*seedIndex;
 const recommended=simulateAttackPath(snapshot,baseline.level,baseline.circles,rows,from,to,
  {carryItems:baseline.carry,seed});
 const actual=evaluateLoadout(snapshot,snapshot.level,snapshot.circles,rows,from,to,
  {carryItems:snapshot.carry,seed});
 const referenceItemHealing=recommended.itemUses.reduce((sum,item)=>sum+item.healing,0);
 const inPathItemHealing=actual.itemUses.reduce((sum,item)=>sum+item.healing,0);
 const referenceNetDamage=Math.max(0,recommended.damageTaken-
  recommended.survivalHealing-referenceItemHealing);
 const actualNetDamage=Math.max(0,actual.damageTaken-actual.survivalHealing-inPathItemHealing);
 const rawExcess=Math.max(0,actual.damageTaken-recommended.damageTaken);
 const recoveryExcess=Math.max(0,actualNetDamage-referenceNetDamage);
 const recoveryHero={...actual.hero,statuses:actual.hero.statuses.map(x=>({...x})),
  cooldowns:[...actual.hero.cooldowns],spells:actual.hero.spells.map(x=>({...x}))};
 const recoveryCarry=actual.carry.map(x=>({...x}));
 const usedItems=[...actual.itemUses];
 const itemRecovery=recoverWithItems(recoveryHero,recoveryCarry,recoveryExcess,from,to,usedItems);
 const spellRecovery=supportRecovery(recoveryHero,snapshot,itemRecovery.remaining,
  recoveryCarry,usedItems,actual.recoveryByEnemy);
 const allItemMp=usedItems.reduce((sum,item)=>sum+item.mpRestored,0);
 const finalDamage=Math.max(0,actualNetDamage-itemRecovery.healing-spellRecovery.healing);
 const totalMpBurden=actual.attackMp+actual.supportMp+spellRecovery.mp;
 const recommendedMpBurden=recommended.attackMp+recommended.supportMp;
 const mpSupply=actual.maxMp+actual.victoryRecovery+allItemMp;
 const mpShortfall=Math.max(0,totalMpBurden-mpSupply);
 const actionLimit=actual.floors.reduce((sum,floor)=>sum+floor.recoverySlack,0);
 const reasons=[];
 if(itemRecovery.remaining>0&&!spellRecovery.possible)
  reasons.push(spellRecovery.reason);
 if(spellRecovery.actions>actionLimit)reasons.push('RECOVERY_ACTION_LIMIT');
 if(finalDamage>referenceNetDamage+1e-8)
  reasons.push('RECOVERY_STOCK_INSUFFICIENT');
 if(mpShortfall>1e-8)reasons.push('MP_RESOURCE_SHORTAGE');
 if(totalMpBurden>recommendedMpBurden+1e-8)
  reasons.push('MP_BURDEN_EXCEEDS_RECOMMENDED');
 const opponents=rows.map(row=>({fight:row.fight,layer:row.layer,id:row.id,
  attributes:[...new Set(row.enemyRow.spells.split('|').map(x=>x.split(':')[1]))]}));
 const compactFloors=path=>path.floors.map(floor=>({...floor,
  attackMp:Math.max(0,floor.attackMp)}));
 return {schemaVersion:'dungeon-recommended-strength-v3',style:snapshot.style??null,
  route:snapshot.route??null,band:from+'-'+to,seedIndex,seed,
  status:reasons.length?'RECOMMENDED_STRENGTH_UNMET':'RECOMMENDED_STRENGTH_REACHED',
  passed:reasons.length===0,reasons,
  methodology:{basis:'same owner base; recommended final-boss level and seed-specific original fixed deck',
   scope:'ten authored floors and all fifty enemies in authored order; each numeric path carries MP across enemies and floors',
   damageFormula:'resolve the shipped G.round formula, statuses, basic attack and direct spell effects against each authored enemy; read resolved incoming attack, basic and burn damage from G.round event text before its separately reported HP-clamped amount',
   actionRule:'the player follows the existing fixed-benchmark highest-effective-damage attack and support thresholds; enemies select through G.chooseEnemySpell using the shared seeded stream and shipped AI preferences',
   executionLimit:'80 player actions per target, matching the shipped turn cap; shadow HP depletion and targets still alive at the cap are recorded, and numeric accounting continues through all fifty targets without treating them as battle wins',
   victoryMp:'apply G.recoverVictoryMp only after that enemy is killed in the formula ledger; reset spell cooldowns at that boundary as the shipped game does',
   damageUnit:'report absolute raw damage and HP-clamped loss separately; compare residual damage after each path\'s actual support healing and item healing; equality is allowed',
   recoveryRule:'recover only residual damage above the fixed reference; apply unused carried healing/elixir effects once, then legal support casts with G.prepare/G.cast inside the unused per-target action budget; this numeric recovery ledger adds no hypothetical enemy action',
   itemRule:'owner carry comes only from the real banked snapshot and must fit capacity; the fixed baseline uses its explicit benchmark cleanse/Luna inventory; each item is counted once and HP/MP effects remain separate',
   spellAccess:'support spells and healing items use the existing F2/F6 unlock rules; item use and support MP are not replenished for free',
   mpRule:'count MP actually spent on attack spells (basic attacks cost zero) and recovery spells; supply includes starting MP, formula-earned victory MP and only MP from actually used carry items',
   scopeLimit:'seeded game-rule damage and resource estimate, not a completed battle, survival result, reward claim, or new battle proof'},
  reference:{level:baseline.level,circles:baseline.circles.map(x=>({role:x.role,
   attribute:x.attribute,power:x.power,basePower:x.basePower,
   upgradeLevel:x.upgradeLevel??0})),attackActions:recommended.attackActions,
   basicAttackActions:recommended.basicAttackActions,
   attackMp:recommended.attackMp,supportMp:recommended.supportMp,
   supportActions:recommended.supportActions,
   mpBurden:recommendedMpBurden,damageDealt:recommended.damageDealt,
   damageAllowed:referenceNetDamage,damageTaken:recommended.damageTaken,
   rawDamageAllowed:recommended.damageTaken,
   damageTakenToHp:recommended.damageTakenToHp,
   netDamage:referenceNetDamage,
   enemyMpSpent:recommended.enemyMpSpent,completedEnemies:recommended.completedEnemies,
   targetsProcessed:recommended.targetsProcessed,
   enemyActionsByRole:recommended.enemyActionsByRole,
   numericTargetsCovered:recommended.numericTargetsCovered,
   shadowHpDepleted:recommended.death,
   shadowHpFloor:recommended.shadowHpFloor,
   hpDepletedAtAction:recommended.hpDepletedAtAction,
   floors:compactFloors(recommended),opponents},
  actual:{level:actual.level,maxHp:actual.maxHp,maxMp:actual.maxMp,
   circles:snapshot.circles.map(x=>({role:x.role,attribute:x.attribute,power:x.power,
    basePower:x.basePower,upgradeLevel:x.upgradeLevel??x.upgrades??0})),
   attackActions:actual.attackActions,basicAttackActions:actual.basicAttackActions,
   attackMp:actual.attackMp,
   supportActions:actual.supportActions,survivalSupportMp:actual.supportMp,
   survivalHealing:actual.survivalHealing,
   damageDealt:actual.damageDealt,damageTaken:actual.damageTaken,
   damageTakenToHp:actual.damageTakenToHp,
   netDamage:actualNetDamage,allowedDamage:referenceNetDamage,
   rawExcessDamage:rawExcess,excessDamage:recoveryExcess,
   enemyMpSpent:actual.enemyMpSpent,completedEnemies:actual.completedEnemies,
   targetsProcessed:actual.targetsProcessed,
   enemyActionsByRole:actual.enemyActionsByRole,
   numericTargetsCovered:actual.numericTargetsCovered,
   shadowHpDepleted:actual.death,
   shadowHpFloor:actual.shadowHpFloor,hpDepletedAtAction:actual.hpDepletedAtAction,
   itemRecovery:{healing:itemRecovery.healing,inPathHealing:inPathItemHealing,
    mpRestored:allItemMp,
    remainingExcess:itemRecovery.remaining,
  uses:usedItems.map(item=>({...item}))},
   magicRecovery:{possible:spellRecovery.possible&&spellRecovery.funded,
    healingPossible:spellRecovery.possible,funded:spellRecovery.funded,
    unfundedMp:spellRecovery.unfundedMp,circle:null,casts:spellRecovery.casts,
    healing:spellRecovery.healing,mp:spellRecovery.mp,incoming:spellRecovery.incoming,
    remainingExcess:spellRecovery.remaining??0,reason:spellRecovery.reason,
    uses:spellRecovery.spellUses??[]},
   recoveryActionLimit:actionLimit,recoveryActions:spellRecovery.actions,
   totalMpBurden,mpShortfall,supply:mpSupply,damageAfterRecovery:finalDamage,
   mpSupply:{start:actual.maxMp,victoryRecovery:actual.victoryRecovery,
    carriedItems:allItemMp,total:mpSupply,remainingAfterAttacks:actual.remainingMp},
   floors:compactFloors(actual)},
  decision:{numericTargetsCovered:actual.numericTargetsCovered,recoveryAvailable:
    itemRecovery.remaining<=0||spellRecovery.possible&&spellRecovery.funded,
   totalMpBurden,recommendedMpBurden,
   mpBurdenWithinRecommendation:totalMpBurden<=recommendedMpBurden+1e-8,
   resourceSufficient:mpShortfall<=1e-8,
   reached:reasons.length===0}};
}

export const strengthBands=goals.bands.map((band,index)=>({
 from:band.from,to:band.to,recommendedLevel:targetClearLevel(band.to),
 opponentIds:targetRows(band.from,band.to).map(x=>x.id),index}));
