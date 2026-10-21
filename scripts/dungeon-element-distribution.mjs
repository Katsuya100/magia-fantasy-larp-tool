// Authored, reproducible final affinity stage after the historical flavor pass.
// IDs, names, base HP/MAG/DEF/RES, drops, spell roles and powers are unchanged.
// Permute elemental defense budgets rather than inventing enemy-only bonuses.
import {nameAffinities} from './dungeon-normal-enemy-affinities.mjs';
export const ELEMENTS=['flame','bolt','aqua','storm','gravity','law','chaos'];
const fmt=n=>String(Number(n.toFixed(2)));

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
  const sum=x=>ELEMENTS.reduce((s,a)=>s+Number(x['resist_'+a]),0);
  if(Math.abs(sum(before)-sum(output))>1e-8)throw Error('Changed resistance budget '+before.id);
  return output;
 });
}
