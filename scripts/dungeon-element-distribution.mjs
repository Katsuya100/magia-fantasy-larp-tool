// Authored, reproducible final affinity stage after the historical flavor pass.
// IDs, names, base HP/MAG/DEF/RES, drops, spell roles and powers are unchanged.
// Permute elemental defense budgets rather than inventing enemy-only bonuses.
import {nameAffinities} from './dungeon-normal-enemy-affinities.mjs';
export const ELEMENTS=['flame','bolt','aqua','storm','gravity','law','chaos'];
const fmt=n=>String(Number(n.toFixed(2)));
// Targeted encounter resistance calibration for 128-seed long-sortie parity.
// These are individual counterplay reallocations (not enemy-only stat growth):
// less damage from a dominant conventional attack, more from an unprotected
// alternate element, with the seven-element defense budget exactly conserved.
export const combatBalanceResistCalibrations=Object.freeze({
 "foe_l025_1": 0.12,
 "foe_l026_1": 0.12,
 "foe_l026_3": 0.12,
 "foe_l027_1": 0.12,
 "foe_l027_3": 0.12,
 "foe_l028_2": 0.12,
 "foe_l028_4": 0.12,
 "foe_l029_1": 0.12,
 "foe_l029_3": 0.12,
 "foe_l030_2": 0.2,
 "foe_l030_4": 0.2,
 "boss_l030": 0.2,
 "foe_l069_2": 0.12,
 "foe_l069_4": 0.12,
 "foe_l070_2": 0.12,
 "foe_l070_4": 0.12,
 "foe_l075_1": 0.12,
 "foe_l075_3": 0.12,
 "foe_l076_2": 0.12,
 "foe_l076_4": 0.12,
 "foe_l077_2": 0.12,
 "foe_l077_4": 0.12,
 "foe_l078_2": 0.12,
 "foe_l078_4": 0.12,
 "foe_l079_2": 0.12,
 "foe_l079_4": 0.12,
 "foe_l080_2": 0.12,
 "foe_l080_4": 0.12,
 "foe_l088_2": 0.2,
 "foe_l088_4": 0.2,
 "foe_l089_2": 0.2,
 "foe_l089_4": 0.2,
 "foe_l090_2": 0.28,
 "foe_l090_4": 0.28,
 "foe_l095_1": 0.12,
 "foe_l095_3": 0.12,
 "foe_l096_2": 0.12,
 "foe_l096_4": 0.12,
 "foe_l097_2": 0.12,
 "foe_l097_4": 0.12,
 "foe_l098_2": 0.12,
 "foe_l098_4": 0.12,
 "foe_l099_2": 0.12,
 "foe_l099_4": 0.12,
 "foe_l100_2": 0.12,
 "foe_l100_4": 0.12,
 "boss_l028": 0.12,
 "boss_l029": 0.12,
 "foe_l030_1": 0.2,
 "foe_l030_3": 0.2,
 "boss_l085": 0.2,
 "boss_l086": 0.2,
 "boss_l088": 0.2,
 "boss_l089": 0.26,
 "boss_l090": 0.28,
 "foe_l090_1": 0.12,
 "boss_l097": 0.12,
 "boss_l098": 0.12,
 "boss_l099": 0.12,
 "foe_l097_1": 0.12,
 "foe_l098_1": 0.12,
 "boss_l069": 0.35,
 "boss_l070": 0.35,
 "boss_l087": 0.2,
 "foe_l027_2": 0.12,
 "foe_l027_4": 0.12,
 "foe_l028_1": 0.12,
 "foe_l028_3": 0.12,
 "foe_l029_2": 0.12,
 "foe_l029_4": 0.12,
 "foe_l089_1": 0.12,
 "foe_l089_3": 0.12,
 "foe_l090_3": 0.12,
 "foe_l036_1": 0.12,
 "foe_l036_3": 0.12,
 "foe_l037_1": 0.12,
 "foe_l037_3": 0.12,
 "foe_l038_1": 0.12,
 "foe_l038_3": 0.12,
 "foe_l039_1": 0.12,
 "foe_l039_3": 0.12,
 "foe_l040_1": 0.12,
 "foe_l040_3": 0.12,
 "boss_l040": 0.12,
 "foe_l061_1": -0.15,
 "foe_l062_2": -0.15,
 "foe_l063_1": -0.15,
 "foe_l064_1": -0.15,
 "foe_l068_2": 0.12,
 "foe_l068_4": 0.12,
 "foe_l069_1": 0.18,
 "foe_l069_3": 0.18,
 "foe_l070_1": 0.18,
 "foe_l070_3": 0.18
});


export function applyElementDistribution(source,plan,concepts){
 if(source.length!==500||plan.length!==500||concepts.length!==100)
  throw Error('Expected exactly 500 enemies, 500 assignments and 100 floor concepts');
 const lookup=new Map(plan.map(r=>[r.id,r]));
 if(lookup.size!==500)throw Error('Duplicate planned enemy ID');
 if(new Set(concepts.map(x=>x.concept)).size!==100)throw Error('Every floor needs its own named concept');
 for(let i=0;i<100;i++){
  if(Number(concepts[i].layer)!==i+1||!concepts[i].concept||!concepts[i].interpretation)
   throw Error('Missing authored concept for floor '+(i+1));
 }
 return source.map((before,i)=>{
  const assigned=lookup.get(before.id);
  if(!assigned||!ELEMENTS.includes(assigned.primary)||!ELEMENTS.includes(assigned.secondary)
    ||assigned.primary===assigned.secondary)
   throw Error('Invalid element plan for '+before.id);
  const spells=before.spells.split('|').map(s=>s.split(':'));
  if(spells.length!==5||spells.some(s=>s.length!==3))throw Error('Malformed five-spell record '+before.id);
  const fromMain=spells[0][1],fromSub=spells[2][1];
  const toMain=assigned.primary,toSub=assigned.secondary;
  if(before.id==='boss_l080'&&(fromMain!==toMain||fromSub!==toSub))
   throw Error('80F star-eclipse counterplay is protected');
  const output={...before};
  for(const k of [0,1,3])spells[k][1]=toMain;
  for(const k of [2,4])spells[k][1]=toSub;
  output.spells=spells.map(s=>s.join(':')).join('|');
  if(before.id==='boss_l080')return output;

  const originalRes=Object.fromEntries(ELEMENTS.map(a=>[a,Number(before['resist_'+a])]));
  const transfer={},used=new Set();
  const bind=(destination,sourceAttr)=>{
   if(Object.hasOwn(transfer,destination)||used.has(sourceAttr))throw Error('Element permutation collision '+before.id);
   transfer[destination]=originalRes[sourceAttr];used.add(sourceAttr);
  };
  bind(toMain,fromMain);bind(toSub,fromSub);
  for(const a of ELEMENTS)if(!Object.hasOwn(transfer,a)&&!used.has(a))bind(a,a);
  const remaining=ELEMENTS.filter(a=>!used.has(a));
  for(const a of ELEMENTS)if(!Object.hasOwn(transfer,a))bind(a,remaining.shift());
  const named=nameAffinities(before.name),protectedAttrs=new Set([toMain,toSub,...named]);
  for(const a of protectedAttrs){
   if(transfer[a]<=1)continue;
   const safe=ELEMENTS.find(other=>!protectedAttrs.has(other)&&transfer[other]<=1);
   if(!safe)throw Error('No opposing weakness for '+before.id+' '+a);
   [transfer[a],transfer[safe]]=[transfer[safe],transfer[a]];
  }
  if(named.length&&!named.some(a=>transfer[a]<1)){
   const a=named.find(k=>transfer[k]===1);
   const donor=ELEMENTS.find(k=>!protectedAttrs.has(k)&&transfer[k]===1);
   if(a&&donor){transfer[a]=.95;transfer[donor]=1.05;}
   else throw Error('Name has no protected resistance '+before.id);
  }
  for(const a of ELEMENTS)output['resist_'+a]=fmt(transfer[a]);
  if(before.id==='boss_l100'){
   // The throne binds Chaos under Law. Purifying water takes over the old
   // Law weakness; keep flame/bolt/gravity combat calibration untouched.
   output.resist_bolt='0.95';
   output.resist_aqua='1.35';
   output.resist_gravity='1';
  }
  const balanceShift=combatBalanceResistCalibrations[before.id];
  if(balanceShift){
   const defaultAttacks=[['flame',360],['bolt',420],['gravity',540]];
   const guarded=defaultAttacks
    .map(([attr,power])=>({attr,score:Math.sqrt(power)*Number(output['resist_'+attr])}))
    .sort((a,b)=>b.score-a.score)[0].attr;
   const alternate=['chaos','law','storm','aqua'].find(a=>!protectedAttrs.has(a));
   if(!alternate)throw Error('No alternate elemental counter for '+before.id);
   output['resist_'+guarded]=fmt(Number(output['resist_'+guarded])-balanceShift);
   output['resist_'+alternate]=fmt(Number(output['resist_'+alternate])+balanceShift);
  }
  const sum=x=>ELEMENTS.reduce((s,a)=>s+Number(x['resist_'+a]),0);
  if(Math.abs(sum(before)-sum(output))>1e-8)throw Error('Changed resistance budget '+before.id);
  return output;
 });
}
