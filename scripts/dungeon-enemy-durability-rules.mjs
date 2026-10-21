// Characteristic physical / magical survivability for all 500 monsters.
// No MAG, spell, status, drops, ID or level changes. No simulation here.
import {durabilityArchetype,durabilityRanges} from '../assets/js/dungeon-durability-profiles.mjs';
export {durabilityArchetype,durabilityRanges};
// Precisely the 12 explicitly approved corrections. The 23 candidates for later
// micro-tuning are deliberately NOT touched by these individual overrides.
export const curatedDurabilityFixes = Object.freeze({
 'foe_l023_2':Object.freeze({hp:105,def:9,res:8}),
 'foe_l041_2':Object.freeze({hp:108,def:9,res:8}),
 'foe_l052_2':Object.freeze({hp:94,def:8,res:8}),
 'foe_l053_3':Object.freeze({hp:88,def:5,res:12}),
 'foe_l059_4':Object.freeze({hp:96,def:9,res:10}),
 'foe_l068_3':Object.freeze({hp:99,def:11,res:10}),
 'foe_l071_2':Object.freeze({hp:98,def:9,res:8}),
 'foe_l084_4':Object.freeze({hp:98,def:9,res:10}),
 'foe_l085_4':Object.freeze({hp:99,def:9,res:10}),
 'foe_l088_2':Object.freeze({hp:111,def:8,res:11}),
 'foe_l095_2':Object.freeze({hp:104,def:8,res:8}),
 'foe_l100_2':Object.freeze({hp:108,def:8,res:8})
});
export const tuneDurability = function tuneDurability(input){
 const rows=input.map(r=>({...r}));
 const clamp=(n,[low,high])=>Math.max(low,Math.min(high,n));
 for(const row of rows){
  const type=durabilityArchetype(row.name);
  const range=durabilityRanges[row.boss_only==='1'?'boss':'normal'][type];
  for(const stat of ['hp','def','res'])row[stat]=String(clamp(Number(row[stat]),range[stat]));
  const correction=curatedDurabilityFixes[row.id];
  if(correction){
   if(row.boss_only!=='0')throw Error('curated correction must target normal enemy '+row.id);
   for(const stat of ['hp','def','res']){
    if(correction[stat]<range[stat][0]||correction[stat]>range[stat][1])
     throw Error('curated correction outside archetype '+row.id+' '+stat);
    row[stat]=String(correction[stat]);
   }
  }
 }
 return rows;
};
