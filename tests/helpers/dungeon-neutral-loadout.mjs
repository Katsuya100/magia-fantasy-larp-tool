// Test-only magic circles: select a single loadout before a full sortie.
// A circle never changes its attribute between fights/floors.
import {ATTRS,basePower} from '../../assets/js/dungeon-core.mjs';

const EPSILON=1e-9;
function resistance(enemy,attribute){
 const value=Number(enemy['resist_'+attribute]);
 if(!Number.isFinite(value)||value<=0)
  throw Error('Invalid enemy resistance for '+enemy.id+' '+attribute);
 return value;
}
function score(rows,attributes){
 let unavoidablyAffected=0,nearestDeviation=0,totalDeviation=0;
 for(const enemy of rows){
  const deviations=attributes.map(attr=>Math.abs(resistance(enemy,attr)-1));
  const closest=Math.min(...deviations);
  if(closest>EPSILON)unavoidablyAffected++;
  nearestDeviation+=closest;
  totalDeviation+=deviations.reduce((sum,value)=>sum+value,0);
 }
 // First maximize encounters with at least one truly neutral circle.
 // Next minimize unavoidable deviation and then incidental slot exposure.
 return [unavoidablyAffected,nearestDeviation,totalDeviation];
}
function better(a,b){
 if(!b)return true;
 for(let i=0;i<a.length;i++){
  if(a[i]<b[i]-EPSILON)return true;
  if(a[i]>b[i]+EPSILON)return false;
 }
 return false; // Stable ATTRS-order tie-break.
}
export function selectNeutralAttackAttributes(enemyMaster,fromLayer,toLayer,attackCount){
 if(!Number.isInteger(fromLayer)||!Number.isInteger(toLayer)||fromLayer<1||toLayer<fromLayer||
    !Number.isInteger(attackCount)||attackCount<1)
  throw Error('Invalid neutral loadout range or attack slot count');
 const rows=enemyMaster.slice((fromLayer-1)*5,toLayer*5);
 if(rows.length!==(toLayer-fromLayer+1)*5)throw Error('Missing enemies in sortie range');
 // When possible, EVERY attack circle must be neutral against EVERY opponent.
 const alwaysNeutral=ATTRS.filter(attr=>rows.every(enemy=>Math.abs(resistance(enemy,attr)-1)<=EPSILON));
 if(alwaysNeutral.length)
  return Array.from({length:attackCount},(_,i)=>alwaysNeutral[i%alwaysNeutral.length]);
 // Otherwise choose the least biased fixed set for the WHOLE sortie, not
 // a new hand-picked weakness/resistance counter for each encounter.
 let best=null,bestScore=null;
 const pick=(indexes,start)=>{
  if(indexes.length===attackCount){
   const attributes=indexes.map(i=>ATTRS[i]),candidate=score(rows,attributes);
   if(better(candidate,bestScore)){best=attributes;bestScore=candidate;}
   return;
  }
  for(let i=start;i<ATTRS.length;i++)pick([...indexes,i],i); // repeats allowed
 };
 pick([],0);
 return best;
}
export function withNeutralAttackAttributes(spells,enemyMaster,fromLayer,toLayer){
 const attackCount=spells.filter(spell=>spell.role==='attack').length;
 const attackAttributes=attackCount
  ?selectNeutralAttackAttributes(enemyMaster,fromLayer,toLayer,attackCount):[];
 let index=0;
 return {attackAttributes,spells:spells.map(spell=>({...spell,
  attribute:spell.role==='attack'?attackAttributes[index++]:spell.attribute}))};
}
// Select the most neutral cast first, not the spell that happens to exploit a
// particular foe's weakness. Matchup-neutral ties favor stronger spells.
export function compareNeutralAttackChoices(hero,enemy,a,b){
 const metric=i=>Math.abs(resistance(enemy,hero.spells[i].attribute)-1);
 return metric(a)-metric(b)||
  basePower(hero.spells[b].power)-basePower(hero.spells[a].power)||a-b;
}
