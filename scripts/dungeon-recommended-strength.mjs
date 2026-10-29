// Formula-only journey strength ledger. It uses the same authored ten floors and
// fifty enemy records for a real owner and the recommended fixed deck. The
// local actors are disposable formula inputs; this is not a battle or a win.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {referenceSpells} from './dungeon-fixed-deck-reference.mjs';
import {journeyItemAllowed,journeySpellAllowed} from './dungeon-test-contract.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base'),items:csv('consumables'),enemies:csv('enemies'),
 buffs:csv('buffs'),collections:csv('collections')};
configure(data);
const goals=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
const ACTION_LIMIT=80;
const deterministic=()=>.5;

function makeHero(snapshot,level,circles){
 return G.makeUnit(snapshot.playerBase,level,{},circles.map(c=>({role:c.role,
  attribute:c.attribute,power:c.power,basePower:c.basePower,
  upgradeLevel:c.upgradeLevel??c.upgrades??0})),'hero');
}

function basicDamage(source,target,side){
 const events=[],observer=event=>events.push(event);
 observer.metricsOnly=true;
 const actorA=G.makeUnit(source.base,source.level,{},source.spells,source.id);
 const actorB=G.makeUnit(target.base,target.level,target.resists,target.spells,target.id);
 G.round(actorA,actorB,-1,-1,data.buffs,deterministic,observer);
 return events.find(event=>event.side===side&&event.role==='basic')?.amount??0;
}

const tickCooldowns=actor=>{actor.cooldowns=actor.cooldowns.map(value=>Math.max(0,value-1));};

function selectAttack(actor,target,side){
 const candidates=G.available(actor).filter(index=>actor.spells[index]?.role==='attack')
  .map(index=>({index,damage:G.damage(actor,target,actor.spells[index],deterministic),
   mp:G.spellMpCost(actor.spells[index])}))
  .sort((a,b)=>b.damage-a.damage||a.mp-b.mp||a.index-b.index);
 const selected=candidates[0];
 if(selected){
  const spell=G.prepare(actor,selected.index,deterministic);
  return {damage:G.damage(actor,target,spell,deterministic),mp:selected.mp,
   spellIndex:selected.index,role:'attack'};
 }
 const damage=basicDamage(actor,target,side);
 return {damage,mp:0,spellIndex:-1,role:'basic'};
}

function selectEnemyResponse(enemy,hero){
 const selected=G.available(enemy).filter(index=>enemy.spells[index]?.role==='attack')
  .map(index=>({index,damage:G.damage(enemy,hero,enemy.spells[index],deterministic),
   mp:G.spellMpCost(enemy.spells[index])}))
  .sort((a,b)=>b.damage-a.damage||a.mp-b.mp||a.index-b.index)[0];
 if(selected){
  const spell=G.prepare(enemy,selected.index,deterministic);
  return {damage:G.damage(enemy,hero,spell,deterministic),mp:selected.mp,
   spellIndex:selected.index,role:'attack'};
 }
 return {damage:basicDamage(enemy,hero,'enemy'),mp:0,spellIndex:-1,role:'basic'};
}

function survivalSupport(hero,enemy,incoming,layer,unlocked){
 if(hero.hp>incoming)return null;
 const choices=G.available(hero).filter(index=>hero.spells[index]?.role==='support'&&
  journeySpellAllowed(layer,unlocked,'support')).map(index=>{
  const probe={...hero,statuses:hero.statuses.map(x=>({...x})),
   cooldowns:[...hero.cooldowns],spells:hero.spells.map(x=>({...x}))};
  const spell=G.prepare(probe,index,deterministic),before=probe.hp;
  G.cast(probe,probe,spell,data.buffs,deterministic);
  return {index,healing:probe.hp-before,mp:hero.mp-probe.mp,
   survives:probe.hp-incoming>0,result:probe};
 }).filter(x=>x.survives&&x.healing>0)
  .sort((a,b)=>b.result.hp-a.result.hp||a.mp-b.mp||a.index-b.index);
 const selected=choices[0];
 if(!selected)return null;
 const spell=G.prepare(hero,selected.index,deterministic),before=hero.hp;
 G.cast(hero,hero,spell,data.buffs,deterministic);
 return {circle:selected.index,healing:hero.hp-before,mp:G.spellMpCost(spell)};
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

function simulateAttackPath(snapshot,level,circles,rows,from,to,{carryItems=[]}={}){
 const hero=makeHero(snapshot,level,circles);
 const carry=carryItems.map(item=>({...item})),itemUses=[];
 const floors=Array.from({length:to-from+1},(_,i)=>({layer:from+i,enemies:[],
  attackActions:0,supportActions:0,totalActions:0,recoverySlack:0,attackMp:0,damageDealt:0,damageTaken:0,enemyMpSpent:0,
  unavailableAttackActions:0,infeasibleEnemies:[]}));
 let attackActions=0,attackMp=0,damageDealt=0,damageTaken=0;
 let enemyMpSpent=0,victoryRecovery=0,completedEnemies=0,death=false,totalActions=0;
 let survivalHealing=0,supportMp=0,supportActions=0;
 for(const row of rows){
  const enemy=G.fromEnemy(row.enemyRow,row.enemyLevel),floor=floors[row.layer-from];
  floor.enemies.push(row.id);
  let dealt=0,actions=0,attacks=0,supports=0,enemyMp=0,floorTaken=0,floorMp=0;
  while(enemy.hp>0&&hero.hp>0&&actions<ACTION_LIMIT){
   // A carried mana/elixir is used only when no attack circle is currently
   // affordable. Each actual instance can be used once.
   const legalAttack=G.available(hero).some(index=>hero.spells[index]?.role==='attack');
   if(!legalAttack){
    const manaItem=carry.find(item=>{
     const kind=data.items.find(x=>x.id===item.id)?.kind;
     return applyItemPreview(hero,item,['mana','elixir'],from,to);
    });
    if(manaItem)applyItem(hero,carry,manaItem,itemUses,['mana','elixir'],from,to);
   }
   const enemyAction=selectEnemyResponse(enemy,hero);
   const survival=survivalSupport(hero,enemy,enemyAction.damage,row.layer,
    snapshot.bankedBestLayer>=2);
   const player=survival?{damage:0,mp:survival.mp,spellIndex:survival.circle,
    role:'support'}:selectAttack(hero,enemy,'hero');
   if(player.role==='basic'&&player.damage<=0){
    floor.infeasibleEnemies.push({id:row.id,actions:actions+1,limit:ACTION_LIMIT,
     method:'NO_DAMAGE_ACTION'});
    break;
   }
   actions++;
   totalActions++;
   const before=enemy.hp;
   enemy.hp=Math.max(0,enemy.hp-player.damage);
   const dealtThisTurn=Math.min(before,player.damage);
   dealt+=dealtThisTurn;
   if(survival){survivalHealing+=survival.healing;supportMp+=survival.mp;
    supportActions++;supports++;}else attacks++;
   if(hero.hp<=enemyAction.damage){
    const recovery=carry.filter(item=>applyItemPreview(hero,item,['heal','elixir'],from,to))
     .map(item=>({item,healing:Number(item.value)||0,
      kind:data.items.find(x=>x.id===item.id)?.kind}))
     .sort((a,b)=>b.healing-a.healing||a.item.id.localeCompare(b.item.id))[0];
    if(recovery)applyItem(hero,carry,recovery.item,itemUses,['heal','elixir'],from,to);
   }
   hero.hp=Math.max(0,hero.hp-enemyAction.damage);
   const usedAttack=player.role==='attack';
   if(usedAttack&&!G.available(hero).some(index=>hero.spells[index]?.role==='attack'))
    floor.unavailableAttackActions++;
   enemyMp+=enemyAction.mp;
   floorTaken+=enemyAction.damage;damageTaken+=enemyAction.damage;
   if(player.role==='attack'){floorMp+=player.mp;attackMp+=player.mp;}
   tickCooldowns(hero);tickCooldowns(enemy);
   if(hero.hp<=0){death=true;break;}
   if(enemy.hp<=0)break;
  }
  floor.attackActions+=attacks;floor.supportActions+=supports;
  floor.totalActions+=actions;floor.attackMp+=floorMp;
  floor.recoverySlack+=Math.max(0,ACTION_LIMIT-actions);
  floor.damageDealt+=dealt;
  // Per-enemy deltas avoid averaging and preserve turn-level enemy resources.
  floor.damageTaken+=floorTaken;
  floor.enemyMpSpent+=enemyMp;
  attackActions+=attacks;damageDealt+=dealt;enemyMpSpent+=enemyMp;
  if(enemy.hp>0){
   if(!floor.infeasibleEnemies.some(x=>x.id===row.id))floor.infeasibleEnemies.push({
    id:row.id,actions,limit:ACTION_LIMIT,
    method:death?'PLAYER_HP_DEPLETED':actions>=ACTION_LIMIT?'ACTION_LIMIT':'NO_DAMAGE_ACTION'});
   if(!death&&actions>=ACTION_LIMIT)floor.infeasibleEnemies.at(-1).method='ACTION_LIMIT';
   break;
  }
  if(death)break;
  completedEnemies++;
  hero.cooldowns=hero.cooldowns.map(()=>0);
  victoryRecovery+=G.recoverVictoryMp(hero,row.layer);
  // Victory MP is counted only after this local formula path killed the
  // enemy. No later fight or reward is treated as a real result.
 }
 // Attack MP is the sum of actual G.prepare costs. Victory MP is tracked as
 // supply, never subtracted from gross spending.
 const allComplete=completedEnemies===rows.length&&hero.hp>0;
 return {hero,carry,itemUses,floors,attackActions,attackMp,damageDealt,damageTaken,
  enemyMpSpent,victoryRecovery,completedEnemies,allComplete,death,level:hero.level,
  survivalHealing,supportMp,supportActions,
  totalActions,
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

function recoveryThreat(snapshot,rows){
 let best=null;
 for(const row of rows){
  const enemy=G.fromEnemy(row.enemyRow,row.enemyLevel);
  const attacks=G.available(enemy).filter(index=>enemy.spells[index]?.role==='attack')
   .map(index=>({index,damage:G.damage(enemy,makeHero(snapshot,snapshot.level,
    snapshot.circles),enemy.spells[index],deterministic),
    mp:G.spellMpCost(enemy.spells[index])}))
   .sort((a,b)=>b.damage-a.damage||a.mp-b.mp||a.index-b.index);
  const damage=attacks[0]?.damage??basicDamage(enemy,
   makeHero(snapshot,snapshot.level,snapshot.circles),'enemy');
  if(!best||damage>best.damage)best={row,damage};
 }
 return best;
}

function supportRecovery(hero,snapshot,rows,from,to,remaining,carry,usedItems){
 if(remaining<=0)return {possible:true,casts:0,mp:0,healing:0,incoming:0,
  reason:null,items:[]};
 const unlocked=snapshot.bankedBestLayer>=2;
 const threatInfo=recoveryThreat(snapshot,rows);
 const threat=G.fromEnemy(threatInfo.row.enemyRow,threatInfo.row.enemyLevel);
 const items=[];
 let casts=0,mp=0,healing=0,incoming=0,actions=0,cooldownWaits=0;
 const spellUses=[];
 const actionCap=rows.reduce((sum,row)=>sum+ACTION_LIMIT,0);
 let actionCount=0,reason=null;
 while(remaining>0&&actionCount<actionCap){
  let candidates=G.available(hero).filter(index=>
   hero.spells[index]?.role==='support'&&
   rows.some(row=>journeySpellAllowed(row.layer,unlocked,'support')))
   .map(index=>{
    const clone={...hero,statuses:hero.statuses.map(x=>({...x})),
     cooldowns:[...hero.cooldowns],spells:hero.spells.map(x=>({...x}))};
    const spell=G.prepare(clone,index,deterministic);
    const hpBefore=clone.hp,mpBefore=clone.mp;
    G.cast(clone,clone,spell,data.buffs,deterministic);
    const heal=clone.hp-hpBefore,spent=mpBefore-clone.mp;
    const threatClone={...threat,statuses:threat.statuses.map(x=>({...x})),
     cooldowns:[...threat.cooldowns],spells:threat.spells.map(x=>({...x}))};
    const response=selectEnemyResponse(threatClone,clone);
    const net=heal-response.damage;
    return {index,heal,spent,response,net,
     efficiency:net/Math.max(1,spent),clone,threatClone};
   }).filter(x=>x.heal>0&&x.net>0)
   .sort((a,b)=>b.efficiency-a.efficiency||b.net-a.net||a.index-b.index);
  if(!candidates.length){
   // A real carried mana/elixir may finance a legal cast. It is applied once
   // at its shipped effect; mana is never converted into a guessed MP value.
   const mana=carry.find(item=>applyItemPreview(hero,item,['mana','elixir'],from,to));
   if(mana){
    const before=hero.mp,hpBefore=hero.hp;
    G.potion(hero,{...mana},data.items,data.buffs);
    const mpRestored=hero.mp-before,healed=hero.hp-hpBefore;
    if(mpRestored>0||healed>0){
     carry.splice(carry.findIndex(x=>x.instanceId===mana.instanceId),1);
     const effect={itemId:mana.id,instanceId:mana.instanceId,kind:
      data.items.find(x=>x.id===mana.id)?.kind,healing:healed,mpRestored};
     usedItems.push(effect);items.push(effect);healing+=healed;
     remaining=Math.max(0,remaining-healed);mp+=0;
     continue;
    }
   }
   const coolingSupport=hero.spells.some((spell,index)=>spell?.role==='support'&&
    rows.some(row=>journeySpellAllowed(row.layer,unlocked,'support'))&&
    hero.mp>=G.spellMpCost(spell)&&!G.isSpellSealed(hero,spell)&&
    hero.cooldowns[index]>0);
   if(coolingSupport){
    const response=selectEnemyResponse(threat,hero);
    hero.hp=Math.max(0,hero.hp-response.damage);
    incoming+=response.damage;actions++;actionCount++;cooldownWaits++;
    tickCooldowns(hero);tickCooldowns(threat);
    if(hero.hp<=0){reason='RECOVERY_RESPONSE_DEPLETED_HP';break;}
    continue;
   }
   reason=hero.spells.some(x=>x?.role==='support')?
    'NO_AFFORDABLE_NET_POSITIVE_RECOVERY':'NO_SUPPORT_CIRCLE';
   break;
  }
  const pick=candidates[0],beforeHp=hero.hp,beforeMp=hero.mp;
  const spell=G.prepare(hero,pick.index,deterministic);
  G.cast(hero,hero,spell,data.buffs,deterministic);
  const healed=hero.hp-beforeHp,spent=beforeMp-hero.mp;
  const response=selectEnemyResponse(threat,hero);
  hero.hp=Math.max(0,hero.hp-response.damage);
  healing+=healed;incoming+=response.damage;mp+=spent;
  actions++;
  spellUses.push({circle:pick.index,mp:spent,healing:healed,
   enemyDamage:response.damage});
  remaining=Math.max(0,remaining-healed+response.damage);
  casts++;actionCount++;
  tickCooldowns(hero);tickCooldowns(threat);
  if(hero.hp<=0){reason='RECOVERY_RESPONSE_DEPLETED_HP';break;}
 }
 if(remaining>0&&!reason)reason=actionCount>=actionCap?'RECOVERY_ACTION_LIMIT':'RECOVERY_STOCK_INSUFFICIENT';
 return {possible:remaining<=0,casts,actions,cooldownWaits,mp,healing,incoming,
  reason,items,spellUses,
  remaining,threatEnemy:threatInfo.row.id};
}

function evaluateLoadout(snapshot,level,circles,rows,from,to,{carryItems=[]}={}){
 return simulateAttackPath(snapshot,level,circles,rows,from,to,{carryItems});
}

function referenceFor(bandIndex,seedIndex,snapshot){
 const circles=referenceSpells[bandIndex][seedIndex];
 const level=targetClearLevel(goals.bands[bandIndex].to);
 return {level,circles,hero:makeHero(snapshot,level,circles)};
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
 const recommended=evaluateLoadout(snapshot,baseline.level,baseline.circles,rows,from,to);
 const actual=evaluateLoadout(snapshot,snapshot.level,snapshot.circles,rows,from,to,
  {carryItems:snapshot.carry});
 const rawExcess=Math.max(0,actual.damageTaken-recommended.damageTaken);
 const recoveryHero={...actual.hero,statuses:actual.hero.statuses.map(x=>({...x})),
  cooldowns:[...actual.hero.cooldowns],spells:actual.hero.spells.map(x=>({...x}))};
 const recoveryCarry=actual.carry.map(x=>({...x}));
 const usedItems=[...actual.itemUses];
 const itemRecovery=recoverWithItems(recoveryHero,recoveryCarry,rawExcess,from,to,usedItems);
 const spellRecovery=supportRecovery(recoveryHero,snapshot,rows,from,to,
  itemRecovery.remaining,recoveryCarry,usedItems);
 const allItemHealing=usedItems.reduce((sum,item)=>sum+item.healing,0);
 const allItemMp=usedItems.reduce((sum,item)=>sum+item.mpRestored,0);
 const finalDamage=actual.damageTaken+spellRecovery.incoming-
  actual.survivalHealing-allItemHealing-spellRecovery.healing;
 const totalMpBurden=actual.attackMp+actual.supportMp+spellRecovery.mp;
 const recommendedMpBurden=recommended.attackMp+recommended.supportMp;
 const mpSupply=actual.maxMp+actual.victoryRecovery+allItemMp;
 const mpShortfall=Math.max(0,totalMpBurden-mpSupply);
 const actionLimit=actual.floors.reduce((sum,floor)=>sum+floor.recoverySlack,0);
 const reasons=[];
 if(!recommended.allComplete)reasons.push('REFERENCE_FORMULA_PATH_INCOMPLETE');
 if(!actual.allComplete)reasons.push(actual.death?'PLAYER_HP_DEPLETED':
  'INSUFFICIENT_ATTACKS_WITHIN_80_TURNS');
 if(actual.allComplete&&itemRecovery.remaining>0&&!spellRecovery.possible)
  reasons.push(spellRecovery.reason);
 if(spellRecovery.actions>actionLimit)reasons.push('RECOVERY_ACTION_LIMIT');
 if(finalDamage>recommended.damageTaken+1e-8)
  reasons.push('RECOVERY_STOCK_INSUFFICIENT');
 if(mpShortfall>1e-8)reasons.push('MP_RESOURCE_SHORTAGE');
 if(totalMpBurden>recommendedMpBurden+1e-8)
  reasons.push('MP_BURDEN_EXCEEDS_RECOMMENDED');
 const opponents=rows.map(row=>({fight:row.fight,layer:row.layer,id:row.id,
  attributes:[...new Set(row.enemyRow.spells.split('|').map(x=>x.split(':')[1]))]}));
 const compactFloors=path=>path.floors.map(floor=>({...floor,
  attackMp:Math.max(0,floor.attackMp)}));
 return {schemaVersion:'dungeon-recommended-strength-v2',style:snapshot.style??null,
  route:snapshot.route??null,band:from+'-'+to,seedIndex,seed:17011+13*seedIndex,
  status:reasons.length?'RECOMMENDED_STRENGTH_UNMET':'RECOMMENDED_STRENGTH_REACHED',
  passed:reasons.length===0,reasons,
  methodology:{basis:'same owner base; recommended final-boss level and seed-specific original fixed deck',
   scope:'ten authored floors, fifty enemies in authored order; each formula path carries MP across enemies and floors',
   damageFormula:'G.damage using each authored enemy base, level, armor, resistances and direct attack attributes; ordinary attacks use the shipped G.round formula',
   attackRule:'on each action choose the highest-damage direct attack among G.available and spend it through G.prepare; use the shipped basic attack only when no attack spell is affordable and ready; resolve each enemy response from its strongest currently legal direct attack with its own MP and cooldown state',
   executionLimit:'80 player actions per enemy, matching the shipped turn cap; stop the formula path on death or an unkillable enemy',
   victoryMp:'apply G.recoverVictoryMp only after that enemy is killed in the formula ledger; reset spell cooldowns at that boundary as the shipped game does',
   damageUnit:'absolute raw HP damage across the ten-floor band; equal damage is allowed',
   recoveryRule:'recover only the excess over the fixed reference raw damage; use each actual carried heal/elixir instance at its shipped effect, then legal support spells with G.prepare/G.cast and one conservative legal enemy response per cast',
   itemRule:'carry comes only from the real banked owner snapshot and must fit capacity; items are counted once, with HP and MP effects reported separately; mana is never converted into HP',
   spellAccess:'support spells and healing items use the existing F2/F6 unlock rules; item use and support MP are not replenished for free',
   mpRule:'gross attack MP plus recovery-spell MP is compared with reference attack MP; supply includes starting MP, formula-earned victory MP and only MP from actually used carry items',
   scopeLimit:'deterministic resource and damage formula estimate, not game AI, encounter execution, win/reward evidence, or a new battle proof'},
  reference:{level:baseline.level,circles:baseline.circles.map(x=>({role:x.role,
   attribute:x.attribute,power:x.power,basePower:x.basePower,
   upgradeLevel:x.upgradeLevel??0})),attackActions:recommended.attackActions,
   attackMp:recommended.attackMp,supportMp:recommended.supportMp,
   mpBurden:recommendedMpBurden,damageDealt:recommended.damageDealt,
   damageAllowed:recommended.damageTaken,damageTaken:recommended.damageTaken,
   enemyMpSpent:recommended.enemyMpSpent,completedEnemies:recommended.completedEnemies,
   attackFeasible:recommended.allComplete,floors:compactFloors(recommended),opponents},
  actual:{level:actual.level,maxHp:actual.maxHp,maxMp:actual.maxMp,
   circles:snapshot.circles.map(x=>({role:x.role,attribute:x.attribute,power:x.power,
    basePower:x.basePower,upgradeLevel:x.upgradeLevel??x.upgrades??0})),
   attackActions:actual.attackActions,attackMp:actual.attackMp,
   survivalSupportMp:actual.supportMp,survivalHealing:actual.survivalHealing,
   damageDealt:actual.damageDealt,damageTaken:actual.damageTaken,
   allowedDamage:recommended.damageTaken,excessDamage:rawExcess,
   enemyMpSpent:actual.enemyMpSpent,completedEnemies:actual.completedEnemies,
   attackFeasible:actual.allComplete,death:actual.death,
   itemRecovery:{healing:itemRecovery.healing,mpRestored:allItemMp,
    remainingExcess:itemRecovery.remaining,
    uses:usedItems.map(({instanceId,...item})=>item)},
   magicRecovery:{possible:spellRecovery.possible,circle:null,casts:spellRecovery.casts,
    healing:spellRecovery.healing,mp:spellRecovery.mp,incoming:spellRecovery.incoming,
    remainingExcess:spellRecovery.remaining??0,reason:spellRecovery.reason,
    threatEnemy:spellRecovery.threatEnemy,uses:spellRecovery.spellUses??[]},
   recoveryActionLimit:actionLimit,recoveryActions:spellRecovery.actions,
   totalMpBurden,mpShortfall,supply:mpSupply,damageAfterRecovery:finalDamage,
   mpSupply:{start:actual.maxMp,victoryRecovery:actual.victoryRecovery,
    carriedItems:allItemMp,total:mpSupply,remainingAfterAttacks:actual.remainingMp},
   floors:compactFloors(actual)},
  decision:{attackFeasible:actual.allComplete,recoveryAvailable:
    itemRecovery.remaining<=0||spellRecovery.possible,
   totalMpBurden,recommendedMpBurden,
   mpBurdenWithinRecommendation:totalMpBurden<=recommendedMpBurden+1e-8,
   resourceSufficient:mpShortfall<=1e-8,
   reached:reasons.length===0}};
}

export const strengthBands=goals.bands.map((band,index)=>({
 from:band.from,to:band.to,recommendedLevel:targetClearLevel(band.to),
 opponentIds:targetRows(band.from,band.to).map(x=>x.id),index}));
