// Seeded combat + banking model. Unlike simulate-dungeon-stones.mjs, never
// grants a victory, rank, recovery item, magic stone, or magic ink by fiat.
// The initial five spell powers are an explicitly named reference *assumption*;
// not a claim about every player-authored drawing.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {allowedStartLayer,unlockedStartLayers,rankBadgeDrop,acquireAdventurerRank} from '../assets/js/dungeon-ranks.mjs';
import {upgradeStoneCost,strengthenedPower,totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {inkEnhancedAnalysis} from '../assets/js/dungeon-ink.mjs';
import {craftAlchemy} from '../assets/js/dungeon-alchemy.mjs';
import {specFor,assess} from './dungeon-readiness-reference.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
// B compares against an actual same-seed A journey, never unapproved median equipment.
const spells=[
 ['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]
];
export const ECONOMY_VERSION='journey-economy-v1-diagnostic';
export const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const quantile=(xs,p)=>{
 if(!xs.length)return null;
 const a=[...xs].sort((x,y)=>x-y),at=(a.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
 return a[lo]+(a[hi]-a[lo])*(at-lo);
};
export const spread=xs=>({p10:quantile(xs,.1),median:quantile(xs,.5),p90:quantile(xs,.9)});
export const investmentRate=layer=>layer<=10?.25:layer<=20?.25+(layer-10)*.05:.75;
const circle=(role,attribute,basePower,active=true)=>({role,attribute,basePower,upgrades:0,active,ink:0});
const actualPower=c=>strengthenedPower(c.basePower,c.upgrades);
const equipped=circles=>circles.filter(c=>c.active).map(c=>({
 role:c.role,attribute:c.attribute,power:actualPower(c),basePower:c.basePower,upgradeLevel:c.upgrades
}));
const percent=(value,max)=>max>0?100*value/max:null;
const chestSummary=p=>({level:p.level,rank:p.adventurerRank,xp:p.xp});

export function chooseHero(hero,enemy,layer,utilityUnlocked,route,pendingGrade){
 const ready=G.available(hero);
 // Attack-only through the first banked F2 clear. Unlock utility only
 // after a legitimate return; do not simulate a free unlock.
 const heal=utilityUnlocked?ready.find(i=>hero.spells[i].role==='support'):undefined;
 // A finishing blow must not be postponed for a costly heal. Both units
 // still resolve the current round, so require enough HP for a real
 // enemy attack before choosing to end the encounter immediately.
 const attacks=ready.filter(i=>hero.spells[i].role==='attack');
 // Only estimate a lethal reply when early MP-safe finishing is relevant.
 // Deep encounters never use this choice; computing it every round adds
 // millions of pointless damage projections to the 256-owner strict CI.
 if(layer>10&&layer<=20&&
  !(pendingGrade&&String(enemy.id).startsWith('boss_l'))){
  const maxIncoming=Math.max(0,...enemy.spells.filter(s=>s?.role==='attack')
   .map(s=>G.damage(enemy,hero,s,()=>1)));
  if(hero.hp>maxIncoming*1.25){
   const finisher=attacks.find(i=>G.damage(hero,enemy,hero.spells[i],()=>1)>=enemy.hp);
   if(finisher!==undefined)return finisher;
  }
 }
 // Novice rank at F10 checks HP and MP BEFORE the ordinary victory reward.
 // Once utility is legally unlocked, heal proactively for that real badge;
 // never mint a recovery or bypass G.available / actual MP spending.
 // For high-rank expeditions preserve real MP on ordinary encounters,
 // then heal during the actual tenth-floor boss when the HP badge demands it.
 // The same equipped support spell still pays its normal MP cost and turn.
 // The badge samples HP/MP immediately after the lethal boss round.
 // An already legally unlocked support spell should protect the *real*
 // HP reserve before the kill on an unearned 20F+ badge, with ordinary
 // spell MP costs and cooldowns (mana items are separately banked/paid).
 // In a fifty-fight sortie, conserving MP while losing most current HP
 // was empirically causing early deaths with an almost untouched MP gauge.
 // Proactive, paid healing trades that existing MP for survival. It never
 // bypasses available(), consumes no item, and shares ordinary G.round rules.
 const healBelow=layer===10&&utilityUnlocked?.95:
  pendingGrade&&route==='long'?.95:
  route==='long'&&layer>=11&&layer<=20?.93:
  layer>=81?(layer%10===0?.95:.90):.90;
 if(heal!==undefined&&hero.hp/hero.stats.hp<healBelow&&
  (layer!==10||hero.mp/hero.maxMp>.85))return heal;
 // Use the already equipped law-defense circle only when it can protect
 // a vulnerable hero or pre-empt an enemy law seal. Respect cooldown and MP
 // through G.available; do not change battle rules or grant free defense.
 const guard=utilityUnlocked?ready.find(i=>hero.spells[i].role==='defense'):undefined;
 // A law ward is not generic armor: it only protects against law damage
 // and law curses. Casting it merely because HP is low against flame or
 // gravity opponents wastes the paid turn and can cause preventable losses.
 const lawThreat=enemy.spells.some(s=>s?.attribute==='law'&&
  (s.role==='attack'||s.role==='debuff'));
 const needsGuard=(layer===10&&utilityUnlocked&&enemy.id==='boss_l010')||
  (lawThreat&&(layer>=81?hero.hp/hero.stats.hp<.25:
   hero.hp/hero.stats.hp<.69||
   enemy.spells.some(s=>s?.role==='debuff'&&s.attribute==='law')));
 if(guard!==undefined&&needsGuard&&
  !hero.statuses.some(s=>s.id==='resist_'+hero.spells[guard].attribute||
   s.id==='buff_'+hero.spells[guard].attribute))return guard;
 // The exact existing normal attack costs no MP. Finish a weakened
 // opponent with it only when the shipped damage expression predicts a KO;
 // never grant mana, suppress an enemy turn, or fake a hit.
 // MP-safe finishers are valid once the beginner F2 return is banked;
 // protect scarce 11F-20F MP without item recovery before the F20 grade.
 if(layer>=51||(route==='long'&&layer>=11)){
  const relativeArmor=G.armor(enemy)/Math.max(1,enemy.stats.hp/Math.max(1,enemy.base.hp));
  const basic=Math.max(1,Math.round(num('basic_attack')*hero.stats.hp*
   G.factor(hero,'attack')*G.factor(hero,'output')*G.factor(enemy,'incoming')*
   num('def_divisor')/(num('def_divisor')+relativeArmor)));
  if(enemy.hp<=basic)return -1;
 }
 if(attacks.length)return attacks.sort((a,b)=>{
  const score=i=>G.effectivePower(hero,hero.spells[i])*G.resist(enemy,hero.spells[i].attribute);
  return score(b)-score(a)||a-b;
 })[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
function cleanse(hero,carry,layer,usage){
 if(layer<51)return;
 const debuffs=hero.statuses.filter(x=>x.kind==='debuff');
 if(!debuffs.length)return;
 let i=carry.findIndex(x=>x&&x.id==='clear_'+debuffs[0].attribute&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(i<0&&layer>=71)i=carry.findIndex(x=>x&&x.id==='luna_stone'&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(i<0)return;
 const item=carry[i];
 G.potion(hero,item,data.items,data.buffs);
 carry[i]=null;usage[item.id]=(usage[item.id]||0)+1;
}
// Only consume genuinely banked mana potions against an unearned 20F+ rank
// boss, if the hero is below the 80% MP badge threshold plus a spell buffer.
// Consumables are paid from the original carried inventory via G.potion.
function restoreRankMp(state,hero,carry,layer,fight,usage){
 if(layer<20||layer%10!==0||fight%5!==0||
  state.profile.adventurerRank>=layer||hero.mp>=hero.maxMp*.9)return;
 const need=hero.maxMp*.9-hero.mp;
 const choices=carry.map((item,i)=>({item,i})).filter(x=>x.item&&
  data.items.find(row=>row.id===x.item.id)?.kind==='mana'&&
  G.canUseBattleItem(hero,x.item,data.items,data.buffs));
 if(!choices.length)return;
 // Prefer the smallest genuine dose that can meet the target, otherwise
 // the largest real dose; do not manufacture MP or items.
 choices.sort((a,b)=>{
  const av=Number(a.item.value),bv=Number(b.item.value);
  return (av>=need?0:1)-(bv>=need?0:1)||
   (av>=need?av-bv:bv-av);
 });
 const {item,i}=choices[0];
 G.potion(hero,item,data.items,data.buffs);
 carry[i]=null;usage[item.id]=(usage[item.id]||0)+1;
}
const manaCount=usage=>Object.entries(usage).reduce((n,[id,count])=>
 n+(id.startsWith('mana_')?count:0),0);
// Loadouts are selected only from real banked inventory, with the real
// level-dependent carry cap. No stocked-item fixture is smuggled into economy.
function pack(state,start,goal,rankItems=true){
 // The inventory has *actually dropped* item instances only. Optimise
 // counter-attributes within the legal carry capacity, without adding items.
 const eligible=item=>{
  const row=data.items.find(r=>r.id===item.id);
  // min_layer constrains *drop eligibility*, not ownership or packing.
  // Deep divers can pack a cleanser before reaching the floor where they
  // intend to use it. Item-use policy is enforced separately in cleanse().
  return row&&(row.kind==='clear'&&goal>=51||row.kind==='clear_all'&&goal>=71);
 };
 const cap=G.capacity(state.profile.level);
 const rankTarget=Math.max(20,Math.ceil(start/10)*10);
 const seekingRank=rankItems&&rankTarget<=goal&&rankTarget<=100&&
  state.profile.adventurerRank<rankTarget;
 const mana=seekingRank?state.inventory.filter(item=>
  data.items.find(row=>row.id===item.id)?.kind==='mana').sort((a,b)=>
  Number(b.value)-Number(a.value)).slice(0,Math.min(3,cap)):[];
 const available=state.inventory.filter(eligible);
 const specific=available.filter(item=>item.id!=='luna_stone');
 const luna=available.filter(item=>item.id==='luna_stone');
 const selected=[...mana,...(goal>=71?luna.slice(0,Math.min(2,cap-mana.length)):[])];
 const pressure=new Map();
 const end=Math.min(100,goal);
 for(let layer=Math.max(51,start);layer<=end;layer++)
  for(let slot=0;slot<5;slot++){
   const foe=data.enemies[(layer-1)*5+slot];
   for(const notation of String(foe?.spells||'').split('|')){
    const [role,attribute]=notation.split(':');
    if(role==='debuff')pressure.set(attribute,(pressure.get(attribute)||0)+1);
   }
  }
 const allocated=new Map();
 while(selected.length<cap&&specific.length){
  let best=-1,bestScore=-Infinity;
  for(let i=0;i<specific.length;i++){
   const attr=specific[i].id.slice('clear_'.length);
   const score=(pressure.get(attr)||0)/(1+(allocated.get(attr)||0));
   if(score>bestScore){best=i;bestScore=score;}
  }
  const [item]=specific.splice(best,1);
  selected.push(item);
  const attr=item.id.slice('clear_'.length);
  allocated.set(attr,(allocated.get(attr)||0)+1);
 }
 // Once all actually-owned specialist stock has been selected, extra
 // originally owned broad-spectrum stones may fill still-empty slots.
 for(const item of luna.slice(selected.filter(i=>i.id==='luna_stone').length)){
  if(selected.length===cap)break;
  selected.push(item);
 }
 const chosen=new Set(selected.map(x=>x.instanceId));
 state.inventory=state.inventory.filter(x=>!chosen.has(x.instanceId));
 if(selected.some(item=>!chosen.has(item.instanceId))||selected.length>cap)
  throw Error('Illegal carry capacity or duplicated inventory item');
 return selected;
}
function chooseUpgrade(state){
 // B must repay the exact same-seed A F31 equipment deficit using its OWN
 // banked stones. After F30, unrelated upgrades can exhaust the legal 75%
 // investment budget and stall the recovery route for many repeat sorties.
 // Include defense if it is genuinely behind, but never invent upgrades.
 const gap=state.style==='B'&&state.best>=30?recoveryGap(state):[];
 const recovering=gap.some(required=>required>0);
 const candidates=state.circles.filter((c,i)=>recovering
  ?c.active&&gap[i]>0
  :['attack','support'].includes(c.role));
 if(!candidates.length)return null;
 // Before F30 B deliberately splits stones across the inactive alternatives.
 // After F30 all banked investments go into the remaining original deficits
 // until the real same-owner reference has been recovered.
 const current=state.best+1;
 // When a long dive repeatedly loses its unbanked rewards, use actually
 // owned stone reserves to repair survival-critical equipped magic first.
 // B resumes its normal split investments once no longer stalled.
 const survivalRecovery=state.route==='long'&&state.best>=10&&
  state.losses>=2&&state.trace.at(-1)?.defeat===true;
 const eligible=state.style==='B'&&current<=30&&!survivalRecovery
  ?candidates:candidates.filter(c=>c.active);
 const options=eligible.filter(c=>upgradeStoneCost(c.upgrades)<=state.stones);
 options.sort((a,b)=>{
  const score=c=>{
   const gain=G.basePower(strengthenedPower(c.basePower,c.upgrades+1))-G.basePower(actualPower(c));
   // A paid heal prevents an extra enemy round on every later fight.
   // Compare that repeatable survival benefit against raw one-hit damage,
   // without changing stone costs, limits, magic strength, or enemy rules.
   const survivalWeight=c.role==='support'?2:1;
   return survivalWeight*(gain+.15)/(c.upgrades+1)**.25/upgradeStoneCost(c.upgrades);
  };
  return score(b)-score(a)||candidates.indexOf(a)-candidates.indexOf(b);
 });
 return options[0]||null;
}
function invest(state){
 // The regular A/B/C investment curve is unchanged in successful play.
 // A player who has failed multiple long dives may rationally deploy more
 // ALREADY BANKED stones instead of losing 100+ identical attempts at F11.
 // This is the existing .75 late-investment cap, not a free upgrade.
 const survivalRecovery=state.route==='long'&&state.best>=10&&
  state.losses>=2&&state.trace.at(-1)?.defeat===true;
 const budget=Math.floor(state.earned.stone*
  (survivalRecovery?.75:investmentRate(Math.max(1,state.best+1)))+1e-8);
 // A sunk upgrade is still counted as spent after a redraw.
 while(state.spent.stone<budget&&state.spent.stone+5<=state.earned.stone){
  const candidate=chooseUpgrade(state);if(!candidate)break;
  const cost=upgradeStoneCost(candidate.upgrades);
  if(cost>state.stones||state.spent.stone+cost>budget)break;
  candidate.upgrades++;state.stones-=cost;state.spent.stone+=cost;
 }
}
function recoveryGap(state){
 const target=state.recoveryTarget;
 if(!target)return [];
 return target.map((required,i)=>Math.max(0,required-state.circles[i].upgrades));
}
function considerInkRedraw(state){
 if(state.style!=='C'||state.best<30)return;
 // Conservative reproducible redraw: preserve the CURRENT OWNED ORIGINAL
 // drawing quality, and pay the real five-ink charge for a new base.
 // No favorable randomized circle, free base improvement or upgrade transfer.
 const candidates=state.circles.filter(c=>c.active&&!c.redrawn);
 // A rational unforced redraw only replaces redundant attack circles.
 // Sacrificing the ONLY genuinely invested heal circle at F30 erased healing
 // strength, caused preventable deaths, and defeated the purpose of ink.
 // Forced loss-of-upgrades diagnostics still include every role.
 // Ten sunk attack upgrades are early enough for genuine stone recovery.
 const eligible=state.forceRedraw?candidates:candidates.filter(c=>
  c.role==='attack'&&c.upgrades>=10);
 if(!eligible.length||state.ink<5||state.replacements>=state.redrawLimit)return;
 const candidate=[...eligible].sort((a,b)=>state.forceRedraw
  ?actualPower(a)-actualPower(b)
  :upgradeStoneCost(b.upgrades)-upgradeStoneCost(a.upgrades)||
   b.upgrades-a.upgrades||actualPower(a)-actualPower(b))[0];
 const used=5;
 const newBase=inkEnhancedAnalysis({power:candidate.basePower},used).power;
 const oldPower=actualPower(candidate);
 // Before the first 100F clear, an 80F+ redraw that *immediately*
 // weakens an equipped spell is reckless: no upgrade transfers, and the
 // remaining earned stone budget might not restore its power by the boss.
 // Keep ink in the bank rather than forcing a strategically bad redraw.
 if(!state.forceRedraw&&state.best>=80&&state.best<100&&newBase<oldPower)return;
 // A knowingly weaker immediate spell can have better future stone economy
 // once the original circle's tier becomes costly. C is allowed to take that
 // investment risk, but its actual farming, losses, and power are measured.
 const oldMarginal=candidate.basePower*.1/upgradeStoneCost(candidate.upgrades);
 const newMarginal=newBase*.1/upgradeStoneCost(0);
 if(!state.forceRedraw&&!(newMarginal>oldMarginal&&
  upgradeStoneCost(candidate.upgrades)>upgradeStoneCost(0)))return;
 state.redrawEvents.push({layer:state.best,role:candidate.role,attribute:candidate.attribute,
  oldPower,newPower:newBase,upgradesLost:candidate.upgrades,
  sunkStones:totalUpgradeStoneCost(candidate.upgrades),inkConsumed:used,
  forcedDiagnostic:state.forceRedraw,stoneInvestmentTransferred:0,
  oldMarginalPowerPerStone:oldMarginal,newMarginalPowerPerStone:newMarginal,
  sameDrawingQuality:true});
 state.ink-=used;state.spent.ink+=used;
 if(candidate.upgrades>0)state.sunkCircles++;
 state.replacements++;
 state.circles[state.circles.indexOf(candidate)]={...circle(candidate.role,candidate.attribute,newBase),
  ink:used,redrawn:true};
}
// Craft only when an actual duplicate and five separate existing ingredients
// are in the bank; alchemy is never used in the mandatory no-alchemy economy.
function optionalAlchemy(state){
 if(!state.alchemy)return;
 for(let n=0;n<30;n++){
  const relic=data.collections.find(row=>(state.collection[row.id]||0)>=2);
  if(!relic)break;
  const indexes=state.inventory.map((item,i)=>({i,kind:data.items.find(row=>row.id===item.id)?.kind}))
   .filter(x=>['heal','mana','elixir','escape','revive'].includes(x.kind)).slice(0,5).map(x=>x.i);
  if(indexes.length!==5||state.inventory.length< G.capacity(state.profile.level)+5)break;
  const beforeStones=state.stones,beforeInk=state.ink;
  const beforeItemCount=state.inventory.length;
  const beforeCollectionCount=Object.values(state.collection).reduce((a,b)=>a+b,0);
  const profile={inventory:state.inventory,collection:state.collection,magicStones:state.stones,
   magicInk:state.ink,alchemyCount:state.alchemyCount,carrySlots:[]};
  const after=craftAlchemy(profile,relic,indexes,data.items,data.buffs,state.random,
   ()=>'crafted-'+(++state.itemSerial));
  if(after.inventory.length!==beforeItemCount-4||
     Object.values(after.collection).reduce((a,b)=>a+b,0)!==beforeCollectionCount-1)
   throw Error('Alchemy must consume exactly five owned items and one collected relic to create one item');
  state.ledger.items.alchemyCreated++;
  state.ledger.items.alchemyConsumed+=5;
  state.ledger.collections.alchemyConsumed++;
  state.alchemyCount=after.alchemyCount;state.alchemyCrafts++;
  state.inventory=after.inventory;state.collection=after.collection;
  state.stones=after.magicStones;state.ink=after.magicInk;
  state.earned.stone+=state.stones-beforeStones;state.earned.ink+=state.ink-beforeInk;
  state.alchemyByproducts.stone+=state.stones-beforeStones;
  state.alchemyByproducts.ink+=state.ink-beforeInk;
 }
}
// Readiness is decided only from banked real XP, level, legal rank, five
// owned equipped drawings and paid investments. It NEVER calls combat,
// consults win rates, or guesses a frozen economic median. Preparing a fresh
// sortie legitimately gives full starting HP/MP as in dungeon-app.begin().
function observePrepared(state){
 // A B-strategy return never starts an unbanked 31F attempt while its
 // same-owner, paid F31 recovery deficit remains. The earlier post-F30
 // intermediate state is not a strategy-ready new sortie.
 if(state.style==='B'&&state.best===30&&recoveryGap(state).some(v=>v>0))return;
 const p=state.profile;
 for(let band=1;band<=91;band+=10){
  if(state.preparedSnapshots[band])continue;
  const to=band+9,requiredLevel=targetClearLevel(to);
  if(state.best<band-1)continue;
  if(!unlockedStartLayers(p).includes(band))continue;
  if(p.level<requiredLevel)continue;
  const active=state.circles.filter(c=>c.active);
  if(active.length!==5)continue;
  const hero=G.makeUnit(state.playerBase,p.level,{},equipped(state.circles),'hero');
  // Select from the ACTUAL banked inventory via the ordinary packing rule,
  // but do not remove items from the on-going economic journey.
  const copy={...state,inventory:[...state.inventory]};
  // Strict 50-fight readiness explicitly excludes any MP potion in the
  // prepared combat reference. Rank-specific potion use is journey-only.
  const carry=pack(copy,band,to,false);
  const snapshot={layer:band,to,sortie:state.sorties,level:p.level,
   targetLevel:requiredLevel,rank:p.adventurerRank,xp:p.xp,
   bankedStones:state.stones,bankedInk:state.ink,
   earned:{...state.earned},spent:{...state.spent},
   circles:active.map(c=>({role:c.role,attribute:c.attribute,
    basePower:c.basePower,upgradeLevel:c.upgrades,power:actualPower(c),
    mpCost:G.mpCost(c.basePower),ink:c.ink})),
   carry:carry.map(item=>({...item})),
   bankedInventory:copy.inventory.map(item=>({...item})),
   bankedCollections:{...state.collection},playerBase:{...hero.base},
   playerHp:hero.hp,playerMp:hero.mp,maxHp:hero.stats.hp,maxMp:hero.maxMp,
   cooldowns:[...hero.cooldowns],statuses:hero.statuses.map(x=>({...x})),
   unbankedXp:0,unbankedStone:0,unbankedInk:0,
   actualFights:state.fights,actualSorties:state.sorties,
   actualLosses:state.losses,actualReturns:state.returns,
   repeatedFights:state.replayedFights,bankedExperience:state.bankedXp,
   source:'POST_RETURN_BANKED_AND_INVESTED',
   status:'PREPARED_FROM_ACTUAL_ECONOMY_NOT_FROM_BATTLE_OUTCOME'};
  if(carry.length>G.capacity(p.level))throw Error('Prepared carrying capacity exceeded');
  state.preparedSnapshots[band]=snapshot;
 }
}

// Independent proposed reference readiness, never a revision of the existing
// final-boss-level prepared snapshot, never decided using combat victories.
function observeReference(state){
 const p=state.profile;
 const starts=unlockedStartLayers(p);
 for(let band=1;band<=91;band+=10){
  const s=specFor(band),to=band+9;
  if(state.best<band-1||!starts.includes(band)||p.level<s.startLevel)continue;
  const baseline=state.referenceSnapshots[band];
  const completed=state.farmingSnapshots[band]?.length||0;
  const extra=baseline&&completed<3&&
   state.replayBanked[band]-state.referenceReplayAt[band]>=50*(completed+1);
  if(baseline&&!extra)continue;
  const active=state.circles.filter(c=>c.active);
  if(active.length!==5)continue;
  const hero=G.makeUnit(state.playerBase,p.level,{},equipped(state.circles),'hero');
  const copy={...state,inventory:[...state.inventory]};
  const carry=pack(copy,band,to,false);
  const snapshot={layer:band,to,sortie:state.sorties,level:p.level,
   targetLevel:s.startLevel,rank:p.adventurerRank,xp:p.xp,
   bankedStones:state.stones,bankedInk:state.ink,
   earned:{...state.earned},spent:{...state.spent},
   circles:active.map(c=>({role:c.role,attribute:c.attribute,
    basePower:c.basePower,upgradeLevel:c.upgrades,power:actualPower(c),
    mpCost:G.mpCost(c.basePower),ink:c.ink})),
   carry:carry.map(item=>({...item})),
   // The global owner ledger already proves all banked items; duplicating
   // hundreds of item instances in every replay checkpoint can exhaust V8.
   bankedItems:copy.inventory.length,
   playerBase:{...hero.base},playerHp:hero.hp,playerMp:hero.mp,
   maxHp:hero.stats.hp,maxMp:hero.maxMp,cooldowns:[...hero.cooldowns],
   statuses:hero.statuses.map(x=>({...x})),
   unbankedXp:0,unbankedStone:0,unbankedInk:0,
   actualFights:state.fights,actualSorties:state.sorties,
   actualLosses:state.losses,actualReturns:state.returns,
   source:'POST_RETURN_BANKED_AND_INVESTED'};
  const check=assess(snapshot,s);
  if(!baseline){
   state.referenceLastAttempt[band]={level:p.level,sorties:state.sorties,
    fights:state.fights,reasons:check.reasons};
   if(check.ready){
    state.referenceSnapshots[band]={...snapshot,status:'ACTUAL_OWNER_CANDIDATE_READY'};
    state.referenceReplayAt[band]=state.replayBanked[band];
   }
  }else if(extra){
   // One measured extra loop = fifty actually banked repeated encounters in
   // this decade, not an invented free upgrade or cloned player inventory.
   state.farmingSnapshots[band]??=[];
   state.farmingSnapshots[band].push({...snapshot,
    completedExtraLoops:completed+1,
    additionalBankedReplayFights:state.replayBanked[band]-state.referenceReplayAt[band]});
  }
 }
}
function commit(state,pending,unused,bestLayer){
 const p=state.profile;
 for(const reward of pending.loot){
  if(reward.type==='stone'){state.stones++;state.earned.stone++;}
  else if(reward.type==='ink'){state.ink++;state.earned.ink++;}
  else if(reward.type==='use'){
   state.ledger.items.bankedDrops++;
   state.inventory.push({id:reward.id,value:reward.value,bonus:reward.bonus,
    instanceId:'item-'+(++state.itemSerial)});
  }
  else if(reward.type==='collection'){
   state.ledger.collections.bankedDrops++;
   state.collection[reward.id]=(state.collection[reward.id]||0)+1;
  }
  else if(reward.type==='rank'&&acquireAdventurerRank(p,reward.layer))state.rankGranted++;
 }
 state.inventory.push(...unused.filter(Boolean));
 state.bankedXp=G.normalizeXp(state.bankedXp+pending.xp);
 G.experience(p,pending.xp);
 state.best=Math.max(bestLayer,state.best);
 state.returns++;
 for(const entry of state.rankAudit){
  if(entry.sortie===state.sorties&&entry.eligible)entry.banked=true;
 }
 optionalAlchemy(state);
 // A replacement circle can immediately receive only legitimately banked
 // stones. Do not send C into the next sortie with its sunk upgrades gone
 // while affordable replacements sit unused in the bank.
 considerInkRedraw(state);invest(state);
 for(const row of state.floorAudit){
  if(row.sortie!==state.sorties||!row.banked||!row.replay||!row.cleared)continue;
  const band=10*Math.floor((row.layer-1)/10)+1;
  state.replayBanked[band]+=row.attemptedFights;
 }
 observePrepared(state);
 observeReference(state);
}
function battle(state,hero,layer,fight,carry,random,usage,encounterForFight,utilityUnlocked){
 const foe=encounterForFight(fight);
 const enemyLevel=Number(data.floors[fight-1]?.enemy_level??targetClearLevel(layer));
 const enemy=G.fromEnemy(foe,enemyLevel);
 let healCasts=0,enemyHealCasts=0,rounds=0,enemyDebuffs=0;
 while(hero.hp>0&&enemy.hp>0&&rounds<80){
  cleanse(hero,carry,layer,usage);
  restoreRankMp(state,hero,carry,layer,fight,usage);
  const pendingGrade=layer>=20&&layer%10===0&&
   state.profile.adventurerRank<layer;
  const ours=chooseHero(hero,enemy,layer,utilityUnlocked,state.route,pendingGrade),theirs=G.chooseEnemySpell(enemy,random);
  if(!utilityUnlocked&&ours>=0&&hero.spells[ours].role!=='attack')
   throw Error('Only attack magic is permitted before the banked F2 clear');
  if(ours>=0&&hero.spells[ours].role==='support')healCasts++;
  if(theirs>=0&&enemy.spells[theirs].role==='support')enemyHealCasts++;
  if(theirs>=0&&enemy.spells[theirs].role==='debuff')enemyDebuffs++;
  G.round(hero,enemy,ours,theirs,data.buffs,random);
  rounds++;
 }
 return {win:enemy.hp<=0&&hero.hp>0,foe,enemyLevel,rounds,healCasts,enemyHealCasts,enemyDebuffs};
}
export function runJourney(seed,{style='A',route='short',alchemy=false,
 redrawLimit=3,forceRedraw=false,maxSorties=120,maxFights=10000}={}){
 if(!['A','B','C'].includes(style)||!['short','long'].includes(route))throw Error('Invalid journey');
 if(!Number.isInteger(redrawLimit)||redrawLimit<1||redrawLimit>3)throw Error('Only 1-3 redraws permitted');
 const aReference=style==='B'?runJourney(seed,{style:'A',route,alchemy,redrawLimit,
  forceRedraw:false,maxSorties,maxFights}):null;
 const atA31=aReference?.entrySnapshots[31]??null;
 const recoveryTarget=atA31?.circles.map(c=>c.upgradeLevel)??null;
 const random=rng(seed),playerBase=G.startingBase(random),profile={level:1,xp:0,adventurerRank:0};
 const state={style,route,alchemy,random,profile,playerBase,stones:0,ink:0,inventory:[],collection:{},
  redrawLimit,forceRedraw,redrawEvents:[],
  recoveryTarget,recoveryReference:atA31?'REAL_SAME_SEED_A_F31':'UNAVAILABLE',
  alchemyCount:0,alchemyCrafts:0,alchemyByproducts:{stone:0,ink:0},
  circles:spells.map(([role,attribute,power])=>circle(role,attribute,power)),
  earned:{stone:0,ink:0},spent:{stone:0,ink:0},lost:{stone:0,ink:0,xp:0},
  bankedXp:0,
  ledger:{items:{bankedDrops:0,alchemyCreated:0,battleConsumed:0,alchemyConsumed:0,lostUnbanked:0},
   collections:{bankedDrops:0,alchemyConsumed:0,lostUnbanked:0}},
  best:0,returns:0,losses:0,sorties:0,fights:0,replayedFights:0,
  itemSerial:0,sunkCircles:0,replacements:0,rankChecks:0,rankGranted:0,
  rankAudit:[],floorAudit:[],
  entrySnapshots:{},preparedSnapshots:{},referenceSnapshots:{},referenceLastAttempt:{},
  farmingSnapshots:{},referenceReplayAt:{},replayBanked:Object.fromEntries(Array.from({length:10},(_,i)=>[10*i+1,0])),
  healCasts:0,enemyHealCasts:0,enemyDebuffs:0,cleanseUses:{},rankManaUses:{},trace:[],blockers:[],milestones:[],
  farmingFights:0,recoveryFights:0,recoverySorties:0,recoveryAchieved:false,
  recoveryInitialGap:null,recoveryRemainingGap:null};
 if(style==='B')state.circles.push(circle('attack','storm',300,false),circle('attack','aqua',290,false),circle('support','law',260,false));
 // D is the route axis; this permits A+D, B+D and C+D without
 // inventing a mutually exclusive 'D character'.
 for(let sortie=0;sortie<maxSorties&&
  (state.best<100||profile.adventurerRank<100)&&state.fights<maxFights;sortie++){
  const upcoming=state.best+1;
  // The first F100 clear is not a substitute for earned rank badges.
  // Recover missing earlier badges in order through genuine fights/returns.
  const missingRankAfterClear=state.best>=100&&profile.adventurerRank<100;
  // B deliberately recovers its four original spells via REAL repeat sorties.
  // Same-seed actual A F31 equipment is a comparative preparation target,
  // never a level override, free stone injection, or a hard user-approved cap.
  const deficit=style==='B'&&state.best===30?recoveryGap(state):[];
  const recovering=deficit.some(x=>x>0);
  // The highest unlocked start (rank+1) is AFTER the target replay layer
  // when B has earned the rank at that exact checkpoint. Farm from the
  // previous LEGAL rank checkpoint, never from a non-existent floor.
  const farmStart=Math.max(1,profile.adventurerRank-9);
  // A long expedition banks at complete ten-floor bosses. Before risking
  // the next ten floors, the same real owner can replay the PREVIOUS entire
  // ten-floor expedition, banking only genuine XP, stones and rank awards.
  // No unearned level, resource, or return between floors is manufactured.
  const lastBoss=Math.floor(state.best/10)*10;
  const nextBoss=Math.min(100,Math.ceil((state.best+1)/10)*10);
  // After a failed deep sortie, first replay the preceding *complete*
  // ten-floor expedition to bank genuinely earned XP and stones. Repeated
  // losses otherwise leave a capped long-route player in a dead-end loop.
  // This is not an emergency return inside 1F-50F.
  const failedNewDepth=state.trace.at(-1)?.defeat===true&&
   state.trace.at(-1).goal>lastBoss;
  const training=route==='long'&&state.best>=10&&
   (profile.level<targetClearLevel(nextBoss)||
    profile.adventurerRank<lastBoss||failedNewDepth);
  // Missing earlier earned rank badges must be recovered IN ORDER. A
  // player with rank 70 and deepest 90 cannot legally start from 81:
  // replay 71-80 first, bank the real 80F badge, then replay 81-90.
  // Otherwise a doomed 20-layer dive needlessly loses all pending rewards.
  const rankBehind=profile.adventurerRank<lastBoss;
  const trainingStart=rankBehind?profile.adventurerRank+1:Math.max(1,lastBoss-9);
  const trainingGoal=rankBehind?profile.adventurerRank+10:lastBoss;
  const start=allowedStartLayer(profile,missingRankAfterClear
   ?profile.adventurerRank+1:recovering?farmStart:
   training?trainingStart:profile.adventurerRank+1);
  if(recovering&&start>state.best)throw Error('Recovery route cannot legally start before the target');
  if(training&&start>lastBoss)throw Error('Long training must begin from a legal cleared decade');
  if(recovering&&state.recoveryInitialGap===null)state.recoveryInitialGap=[...deficit];
  if(style==='B'&&state.best>=30&&state.recoveryTarget&&!recovering)state.recoveryAchieved=true;
  // Every first-time adventurer banks each newly cleared floor until an
  // ACTUAL F10 boss victory. Only then do short/long routes diverge.
  const tutorial=state.best<10;
  const goal=missingRankAfterClear?profile.adventurerRank+10:
   recovering?state.best:tutorial?upcoming:
   training?trainingGoal:route==='short'?upcoming:100;
  const utilityUnlocked=state.best>=2;
  if(recovering)state.recoverySorties++;
  const firstLevel=profile.level;
  const hero=G.makeUnit(state.playerBase,firstLevel,{},equipped(state.circles),'hero');
  let pending={xp:0,loot:[]},lastClear=start-1,defeat=false;
  // Long dives bank each decade, so reserve slots for only the next boss.
  const packingGoal=route==='long'?Math.min(goal,Math.ceil(start/10)*10):goal;
  const carry=pack(state,start,packingGoal);
  const usage={};
  const encounterForFight=createSortieEncounterSelector(data.enemies,random);
  state.sorties++;
  for(let layer=start;layer<=goal&&state.fights<maxFights;layer++){
   if(layer%10===1&&!state.entrySnapshots[layer]){
    state.entrySnapshots[layer]={layer,sortie:state.sorties,level:firstLevel,
     targetLevel:targetClearLevel(Math.min(100,layer+9)),rank:profile.adventurerRank,
     xp:profile.xp,actualFights:state.fights,actualSorties:state.sorties,
     actualLosses:state.losses,actualReturns:state.returns,
     bankedStones:state.stones,bankedInk:state.ink,
     earned:{...state.earned},spent:{...state.spent},
     circles:state.circles.filter(c=>c.active).map(c=>({role:c.role,attribute:c.attribute,
      basePower:c.basePower,upgradeLevel:c.upgrades,power:actualPower(c),
      mpCost:G.mpCost(c.basePower),ink:c.ink})),
     carry:carry.filter(Boolean).map(item=>({id:item.id,value:item.value,bonus:item.bonus,
       instanceId:item.instanceId})),
      bankedInventory:state.inventory.map(item=>({...item})),
      bankedCollections:{...state.collection},
     playerBase:{...hero.base},playerHp:hero.hp,playerMp:hero.mp,
     maxHp:hero.stats.hp,maxMp:hero.maxMp,
     cooldowns:[...hero.cooldowns],statuses:hero.statuses.map(x=>({...x})),
     unbankedXp:pending.xp,
     unbankedStone:pending.loot.filter(x=>x.type==='stone').length,
     unbankedInk:pending.loot.filter(x=>x.type==='ink').length,
     status:'ACTUAL_FIRST_ENTRY_WITH_IN_EXPEDITION_RESOURCES'};
   }
   const entryHp=percent(hero.hp,hero.stats.hp),entryMp=percent(hero.mp,hero.maxMp);
   const fightsBeforeLayer=state.fights,lootBeforeLayer=pending.loot.length;
   const xpBeforeLayer=pending.xp,usedBeforeLayer=Object.values(usage).reduce((a,b)=>a+b,0);
   const manaBeforeLayer=manaCount(usage);
   let allWon=true,bossRounds=null;
   for(let slot=1;slot<=5;slot++){
    const fight=(layer-1)*5+slot;
    const outcome=battle(state,hero,layer,fight,carry,random,usage,encounterForFight,utilityUnlocked);
    state.fights++;
    if(recovering)state.recoveryFights++;
    if(layer<=state.best)state.replayedFights++;
    if(layer<=state.best&&style==='B')state.farmingFights++;
    state.healCasts+=outcome.healCasts;
    state.enemyHealCasts+=outcome.enemyHealCasts;
    state.enemyDebuffs+=outcome.enemyDebuffs;
    if(!utilityUnlocked&&outcome.healCasts)
     throw Error('Illegal tutorial heal before the banked F2 clear');
    if(!outcome.win){defeat=true;allWon=false;break;}
    if(slot===5)bossRounds=outcome.rounds;
    const boss=slot===5?outcome.foe.id:null;
    const drops=G.drops(data.items,data.collections,outcome.enemyLevel,random,{
     layer,playerLevel:firstLevel,firstClear:layer>state.best,bossEnemyId:boss,
     favoredCollectionIds:outcome.foe.favored_collection_ids?.split('|')||[]});
    if(boss&&layer%10===0&&layer<=100){
     state.rankChecks++;
     // Two independent outputs: did the ACTUAL player finish the boss
     // above the 80% reserve, and was the banked badge eventually acquired?
     // Observe immediately after the lethal round, before any MP recovery.
     const hpPercent=percent(hero.hp,hero.stats.hp);
     const mpPercent=percent(hero.mp,hero.maxMp);
     const badge=rankBadgeDrop(fight,hero,profile,pending.loot);
     state.rankAudit.push({layer,sortie:state.sorties,level:firstLevel,
      hpPercent,mpPercent,eligible:Boolean(badge),banked:false,
      failure:badge?null:hpPercent<80&&mpPercent<80?'HP_AND_MP_BELOW_80'
       :hpPercent<80?'HP_BELOW_80':mpPercent<80?'MP_BELOW_80'
       :'PRIOR_RANK_OR_DUPLICATE'});
     if(badge)drops.push(badge);
    }
    pending.loot.push(...drops);
    pending.xp=G.normalizeXp(pending.xp+G.fightExperience(outcome.enemyLevel,firstLevel,layer));
    hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
    G.recoverVictoryMp(hero,layer);
   }
   const layerLoot=pending.loot.slice(lootBeforeLayer);
   state.floorAudit.push({sortie:state.sorties,layer,style,route,
    rankPendingAtEntry:layer>=20&&layer%10===0&&profile.adventurerRank<layer,
    attemptedFights:state.fights-fightsBeforeLayer,replay:layer<=state.best,
    bossRounds,
    entryHpPercent:entryHp,entryMpPercent:entryMp,
    exitHpPercent:percent(hero.hp,hero.stats.hp),
    exitMpPercent:percent(hero.mp,hero.maxMp),
    defeated:!allWon,cleared:allWon,
    gainedXp:Math.max(0,G.normalizeXp(pending.xp-xpBeforeLayer)),
    pendingStone:layerLoot.filter(x=>x.type==='stone').length,
    pendingInk:layerLoot.filter(x=>x.type==='ink').length,
    pendingItems:layerLoot.filter(x=>x.type==='use').length,
    pendingCollections:layerLoot.filter(x=>x.type==='collection').length,
    usedOwnedCleansers:Object.values(usage).reduce((a,b)=>a+b,0)-usedBeforeLayer-
     (manaCount(usage)-manaBeforeLayer),
    usedOwnedMana:manaCount(usage)-manaBeforeLayer,
    bossRank:state.rankAudit.findLast(x=>x.layer===layer&&x.sortie===state.sorties)??null,
    banked:false});
   if(!allWon)break;
   lastClear=layer;
   if(layer%10===0){
    // Sample the boss outcome before granting the separately chosen
    // checkpoint recovery; never count full HP/MP as a boss rank award.
    state.milestones.push({layer,provisional:true,level:firstLevel,
     rank:profile.adventurerRank,stones:state.stones,ink:state.ink,
     bossExitHpPercent:percent(hero.hp,hero.stats.hp),
     bossExitMpPercent:percent(hero.mp,hero.maxMp),
     fights:state.fights});
    hero.hp=hero.stats.hp;hero.mp=hero.maxMp;
   }
   // Short journeys bank only AFTER reaching the intended new layer, not
   // after clearing the rank-gated route's first repeated layer.
   // Long journeys prefer a full decade of NEW layers, banking risky
   // unconfirmed loot at that milestone instead of assuming every win.
   if(route==='long'&&layer%10===0&&layer>=state.best+10)break;
   // A risk-aware long dive can still return at a completed layer when
   // resources become critical. These are strategy parameters, NOT new
   // acceptance thresholds for game balance.
   // A real carried mana potion can justify one more floor for an unearned rank boss.
   // The normal return rule still applies to low HP and every non-rank floor.
   const canContinueForRankBoss=layer>=51&&layer%10===9&&layer+1>=20&&
    profile.adventurerRank<layer+1&&carry.some(item=>item&&
     data.items.find(row=>row.id===item.id)?.kind==='mana'&&Number(item.value)>0&&
     G.canUseBattleItem(hero,item,data.items,data.buffs));
   if(route==='long'&&layer>=51&&
    (hero.hp/hero.stats.hp<.3||
     (hero.mp/hero.maxMp<.2&&!canContinueForRankBoss)))break;
  }
  for(const [id,count] of Object.entries(usage)){
    const sink=id.startsWith('mana_')?state.rankManaUses:state.cleanseUses;
    sink[id]=(sink[id]||0)+count;
    state.ledger.items.battleConsumed+=count;
   }
  const earnedPending={stone:pending.loot.filter(x=>x.type==='stone').length,
   ink:pending.loot.filter(x=>x.type==='ink').length};
  for(const row of state.floorAudit.filter(x=>x.sortie===state.sorties))
   row.banked=!defeat;
  if(defeat){
   state.losses++;state.lost.stone+=earnedPending.stone;
   state.lost.ink+=earnedPending.ink;state.lost.xp+=pending.xp;
    state.ledger.items.lostUnbanked+=pending.loot.filter(x=>x.type==='use').length;
    state.ledger.collections.lostUnbanked+=pending.loot.filter(x=>x.type==='collection').length;
   // The shipped game returns unused equipped items to the warehouse on defeat.
   state.inventory.push(...carry.filter(Boolean));
  }else if(lastClear>=start){
   commit(state,pending,carry,lastClear);
  }else state.inventory.push(...carry.filter(Boolean));
  if(style==='B'&&state.best>=30){state.recoveryRemainingGap=recoveryGap(state);
   if(state.recoveryTarget&&state.recoveryRemainingGap.every(x=>x===0))state.recoveryAchieved=true;}
  state.trace.push({sortie:state.sorties,start,goal,cleared:lastClear,defeat,recovering,
   tutorial,training,utilityUnlocked,
   levelBefore:firstLevel,levelAfter:profile.level,rank:profile.adventurerRank,
   gainedPending:earnedPending,banked:!defeat,stone:state.stones,ink:state.ink,
   usedItems:usage,fights:state.fights,returned:!defeat,
   hpPercent:percent(hero.hp,hero.stats.hp),mpPercent:percent(hero.mp,hero.maxMp)});
  // B uses repeated wins as the only stone repair route, not a free redraw.
  // Revisiting is already counted by the rank-dependent legal start floor.
  if(state.trace.length>=3){
   const last=state.trace.at(-1),two=state.trace.at(-2),three=state.trace.at(-3);
   if(last.cleared<=two.cleared&&two.cleared<=three.cleared&&last.levelAfter===three.levelAfter
    &&state.stones<5)state.blockers.push('No effective combat progression or affordable upgrade across three sorties');
  }
 }
 if(state.best<100)state.blockers.push('Failed to clear 100F within measured sortie/fight budget (diagnostic cap, not a passing condition)');
 if(state.best>=100&&profile.adventurerRank<100)
  state.blockers.push('Reached F100 but real rank badges remain unearned within the measurement budget');
 if(style==='B'&&!state.recoveryTarget)state.blockers.push('No same-seed A F31 entry; no invented stone-recovery target');
 const invested=state.circles.map(c=>({active:c.active,role:c.role,attribute:c.attribute,basePower:c.basePower,
  upgradeLevel:c.upgrades,power:actualPower(c),mpCost:G.mpCost(c.basePower),ink:c.ink}));
 const stoneReconciled=state.earned.stone-state.spent.stone-state.stones;
 const inkReconciled=state.earned.ink-state.spent.ink-state.ink;
 if(stoneReconciled!==0||inkReconciled!==0)throw Error('Stone or ink conservation violated');
  const items=state.ledger.items,collections=state.ledger.collections;
  const itemBalance=items.bankedDrops+items.alchemyCreated-items.battleConsumed-items.alchemyConsumed;
  const collectionBalance=collections.bankedDrops-collections.alchemyConsumed;
  const collectionHeld=Object.values(state.collection).reduce((a,b)=>a+b,0);
  if(itemBalance!==state.inventory.length||collectionBalance!==collectionHeld)
   throw Error('Owned item or collection resource conservation violated');
  const instanceIds=state.inventory.map(item=>item.instanceId);
  if(instanceIds.some(id=>typeof id!=='string')||new Set(instanceIds).size!==instanceIds.length)
   throw Error('Duplicate or untracked owned inventory instance');
  const resourceLedger={items:{...items,held:state.inventory.length,reconciled:itemBalance},
   collections:{...collections,held:collectionHeld,reconciled:collectionBalance},
   stones:{banked:state.earned.stone,upgrades:state.spent.stone,held:state.stones,
    lostUnbanked:state.lost.stone},
   ink:{banked:state.earned.ink,redrawSpent:state.spent.ink,held:state.ink,
    lostUnbanked:state.lost.ink}};
 return {seed,style,route,alchemy,playerBase:{...state.playerBase},alchemyCrafts:state.alchemyCrafts,
  alchemyByproducts:state.alchemyByproducts,profile:chestSummary(profile),best:state.best,
  sorties:state.sorties,returns:state.returns,losses:state.losses,fights:state.fights,
  replayedFights:state.replayedFights,farmingFights:state.farmingFights,
  recovery:{extraFights:state.recoveryFights,sorties:state.recoverySorties,
   achieved:state.recoveryAchieved,initialGap:state.recoveryInitialGap,
   remainingGap:state.recoveryRemainingGap,comparison:state.recoveryReference,
   targetUpgrades:state.recoveryTarget},
  earned:state.earned,spent:state.spent,lost:state.lost,
  xpLedger:{banked:state.bankedXp,lost:state.lost.xp,
   level:profile.level,unspentLevelProgress:profile.xp},
   resourceLedger,balances:{stone:state.stones,ink:state.ink},
  inventory:state.inventory.length,collection:state.collection,circles:invested,
  sunkCircles:state.sunkCircles,replacements:state.replacements,redrawEvents:state.redrawEvents,
  healCasts:state.healCasts,enemyHealCasts:state.enemyHealCasts,
  enemyDebuffs:state.enemyDebuffs,cleanseUses:state.cleanseUses,rankManaUses:state.rankManaUses,
  rankChecks:state.rankChecks,rankGranted:state.rankGranted,rankAudit:state.rankAudit,
  floorAudit:state.floorAudit,trace:state.trace,milestones:state.milestones,
  entrySnapshots:state.entrySnapshots,preparedSnapshots:state.preparedSnapshots,
  referenceSnapshots:state.referenceSnapshots,referenceLastAttempt:state.referenceLastAttempt,
  farmingSnapshots:state.farmingSnapshots,replayBanked:state.replayBanked,blockers:state.blockers};
}
export function summarizeJourneys(samples=16,seed=20261024){
 if(!Number.isSafeInteger(samples)||samples<1||samples>512)throw Error('Invalid economy sample count');
 const combinations=['A','B','C'].flatMap(style=>['short','long'].map(route=>({style,route})));
 const all=combinations.map(({style,route})=>{
  const runs=Array.from({length:samples},(_,i)=>runJourney(seed+7919*i,{style,route}));
  const metrics=['best','sorties','returns','losses','fights','replayedFights','farmingFights','rankGranted','healCasts','replacements'];
  const distributions=Object.fromEntries(metrics.map(name=>[name,spread(runs.map(x=>x[name]))]));
  distributions.recoveryFights=spread(runs.map(x=>x.recovery.extraFights));
  distributions.recoverySorties=spread(runs.map(x=>x.recovery.sorties));
  distributions.gradeEligible=spread(runs.map(x=>x.rankAudit.filter(y=>y.eligible).length));
  distributions.gradeFailedMp=spread(runs.map(x=>x.rankAudit.filter(y=>y.failure?.includes('MP_BELOW_80')).length));
  distributions.gradeFailedHp=spread(runs.map(x=>x.rankAudit.filter(y=>y.failure?.includes('HP_BELOW_80')).length));
  for(const type of ['stone','ink']){
   for(const field of ['earned','spent','lost','balances']){
    distributions[field+'.'+type]=spread(runs.map(x=>x[field][type]));
   }
  }
  const checkpoints=Array.from({length:10},(_,i)=>(i+1)*10).map(layer=>{
   const reached=runs.map(r=>r.trace.find(t=>t.cleared>=layer&&!t.defeat)).filter(Boolean);
   const prepared=runs.map(r=>r.entrySnapshots[layer-9]).filter(Boolean);
   return {layer,reached:reached.length,
    level:spread(reached.map(x=>x.levelAfter)),levelGap:spread(reached.map(x=>x.levelAfter-targetClearLevel(layer))),
    stone:spread(reached.map(x=>x.stone)),ink:spread(reached.map(x=>x.ink)),
    fights:spread(reached.map(x=>x.fights)),
    firstEntry:{count:prepared.length,
     level:spread(prepared.map(x=>x.level)),
     levelGap:spread(prepared.map(x=>x.level-x.targetLevel)),
     stoneBalance:spread(prepared.map(x=>x.bankedStones)),
     inkBalance:spread(prepared.map(x=>x.bankedInk)),
     upgrades:[0,1,2,3,4].map(i=>spread(prepared.map(x=>x.circles[i]?.upgradeLevel??0))),
     powers:[0,1,2,3,4].map(i=>spread(prepared.map(x=>x.circles[i]?.power??0)))}};
  });
  // Actual indivisible player states for paired combat. Never synthesize
  // an impossible inventory by combining unrelated per-field medians.
  const floorObservations=Array.from({length:100},(_,i)=>{
   const layer=i+1,observed=runs.flatMap(r=>r.floorAudit.filter(x=>x.layer===layer));
   const clears=observed.filter(x=>x.cleared);
   return {layer,entries:observed.length,clears:clears.length,defeats:observed.length-clears.length,
    replayEntries:observed.filter(x=>x.replay).length,
    bankedClearances:clears.filter(x=>x.banked).length,
    entryHp:spread(observed.map(x=>x.entryHpPercent)),
    entryMp:spread(observed.map(x=>x.entryMpPercent)),
    exitHp:spread(clears.map(x=>x.exitHpPercent)),
    exitMp:spread(clears.map(x=>x.exitMpPercent)),
    bossRounds:spread(clears.filter(x=>x.bossRounds!==null).map(x=>x.bossRounds)),
    firstClearBossRounds:spread(clears.filter(x=>!x.replay&&x.bossRounds!==null)
     .map(x=>x.bossRounds)),
    spentCleanserCount:observed.reduce((n,x)=>n+x.usedOwnedCleansers,0),
    rankEligible:observed.filter(x=>x.bossRank?.eligible).length,
    rankAcquired:observed.filter(x=>x.bossRank?.banked).length};
  });
  const comparisonStates=runs.map(r=>({seed:r.seed,best:r.best,rank:r.profile.rank,
   snapshots:Object.fromEntries(Array.from({length:10},(_,i)=>i*10+1).flatMap(layer=>
    r.entrySnapshots[layer]?[[layer,r.entrySnapshots[layer]]]:[])),
   preparedSnapshots:Object.fromEntries(Array.from({length:10},(_,i)=>i*10+1).flatMap(layer=>
    r.preparedSnapshots[layer]?[[layer,r.preparedSnapshots[layer]]]:[]))}));
  return {style,route,samples,distributions,checkpoints,floorObservations,
    completed:runs.filter(x=>x.best>=100).length,
   blocked:runs.length-runs.filter(x=>x.best>=100).length,comparisonStates,examples:runs.slice(0,2)};
 });
 return {schemaVersion:ECONOMY_VERSION,seed,samples,alchemy:'off',
  assumptions:{circles:spells,playerBase:'one canonical seeded G.startingBase roll per real adventurer, retained across casual-mode losses',
   preparation:'only banked resources; combat uses shipped rules; no HP/MP or revival items',
   cleansers:'only real drops, prepared at start; specific 51F+, Luna Stone 71F+',
   noRankGuarantee:true,defeat:'casual-mode loss: unbanked loot+XP lost; unused carried items return. Permanent-death character reset and legacy recovery are outside this cohort',
   milestones:'choose real full recovery at 10-layer checkpoints',
   cap:'sorties/fights cap is diagnostic and never a success criterion',
   extrapolation:'not evaluated: authored 1-100F only'},
  combinations:all};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const count=Number(process.argv[2]||16);
 const report=summarizeJourneys(count);
 mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
 writeFileSync(new URL('../reports/dungeon-journeys-v1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 for(const row of report.combinations){
  const d=row.distributions;
  console.log('DUNGEON_JOURNEY '+JSON.stringify({style:row.style,route:row.route,completed:row.completed,samples:row.samples,
   best:d.best,levelAt10:row.checkpoints[0].level,
    bossRoundsAtF10:row.floorObservations[9].bossRounds,
    bossF10Clears:row.floorObservations[9].clears,
    stoneAt100:row.checkpoints[9].stone,
   extraFights:d.replayedFights,p90ExtraFights:d.replayedFights.p90,losses:d.losses,
   earnedStone:d['earned.stone'],spentStone:d['spent.stone'],earnedInk:d['earned.ink'],
   replacements:d.replacements}));
 }
 const completed=report.combinations.reduce((n,x)=>n+x.completed,0);
 console.log('DUNGEON_JOURNEYS_SUMMARY '+JSON.stringify({version:ECONOMY_VERSION,
  completed,attempts:6*count,status:completed===6*count?'DIAGNOSTIC_REACHED_100':'DIAGNOSTIC_INCOMPLETE',
  report:'reports/dungeon-journeys-v1.json'}));
}
