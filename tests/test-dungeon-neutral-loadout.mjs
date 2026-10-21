// Test-only neutral loadout policy; executed by GitHub Actions via npm test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {selectNeutralAttackAttributes,withNeutralAttackAttributes,compareNeutralAttackChoices}
 from './helpers/dungeon-neutral-loadout.mjs';

const enemy=(resists={})=>Object.fromEntries(G.ATTRS.map(attr=>[
 'resist_'+attr,String(resists[attr]??1)]));
const oneFloor=Array.from({length:5},()=>enemy({flame:.8,bolt:1.2,aqua:.7,storm:1.3,gravity:.9}));
const neutral=selectNeutralAttackAttributes(oneFloor,1,1,3);
assert.deepEqual(neutral,['law','chaos','law'],
 'if any attribute is neutral throughout, every attack slot stays neutral');
for(const row of oneFloor)for(const attr of neutral)
 assert.equal(Number(row['resist_'+attr]),1);

// Two-floor fixture: no attribute remains neutral across all ten encounters.
// Each candidate has a mismatch somewhere; compare the selected set against
// every possible combination to verify the global, deterministic optimum.
const twoFloors=Array.from({length:10},(_,i)=>enemy({
 [G.ATTRS[i%7]]:i%2===0?.8:1.2
}));
const fallback=selectNeutralAttackAttributes(twoFloors,1,2,3);
const quality=attrs=>{
 let affected=0,closestSum=0,total=0;
 for(const row of twoFloors){
  const deviations=attrs.map(a=>Math.abs(Number(row['resist_'+a])-1));
  const min=Math.min(...deviations);
  affected+=Number(min>1e-9);closestSum+=min;
  total+=deviations.reduce((sum,v)=>sum+v,0);
 }
 return [affected,closestSum,total];
};
const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-9)return a[i]-b[i];return 0;};
const all=[];
for(let i=0;i<G.ATTRS.length;i++)for(let j=i;j<G.ATTRS.length;j++)
 for(let k=j;k<G.ATTRS.length;k++)all.push([G.ATTRS[i],G.ATTRS[j],G.ATTRS[k]]);
assert.equal(G.ATTRS.some(attr=>twoFloors.every(e=>Number(e['resist_'+attr])===1)),false);
for(const candidate of all)assert.ok(compare(quality(fallback),quality(candidate))<=0,
 'chosen set must minimize both unavoidable and incidental affinity deviations');
assert.deepEqual(fallback,selectNeutralAttackAttributes(twoFloors,1,2,3));
assert.throws(()=>selectNeutralAttackAttributes(twoFloors,1,3,3),/Missing enemies/);
assert.throws(()=>selectNeutralAttackAttributes(twoFloors,2,1,3),/Invalid neutral/);

const base=[
 {role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'bolt',power:420},
 {role:'attack',attribute:'gravity',power:540},
 {role:'support',attribute:'aqua',power:320},
 {role:'defense',attribute:'law',power:270}
];
const selected=withNeutralAttackAttributes(base,oneFloor,1,1);
assert.deepEqual(selected.spells.slice(0,3).map(s=>s.attribute),neutral);
assert.deepEqual(selected.spells.slice(3),base.slice(3),'heals/defenses are unaffected');
assert.deepEqual(base.slice(0,3).map(x=>x.attribute),['flame','bolt','gravity'],
 'test loadout rewriting must not mutate spell fixtures');
// A weaker neutral spell is preferred over a stronger weakness exploit.
const fighter={spells:[{role:'attack',attribute:'flame',power:360},
 {role:'attack',attribute:'bolt',power:540}]};
assert.ok(compareNeutralAttackChoices(fighter,{id:'foe',resist_flame:1,resist_bolt:1.5},0,1)<0);

const real=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
for(let first=1;first<=100;first+=10){
 const last=Math.min(100,first+9);
 const attrs=selectNeutralAttackAttributes(real,first,last,3);
 assert.equal(attrs.length,3);
 assert.ok(attrs.every(attr=>G.ATTRS.includes(attr)));
 assert.deepEqual(attrs,selectNeutralAttackAttributes(real,first,last,3));
 const entireBand=real.slice((first-1)*5,last*5);
 const globallyNeutral=G.ATTRS.filter(attr=>entireBand.every(row=>Number(row['resist_'+attr])===1));
 if(globallyNeutral.length)for(const attr of attrs)assert.ok(globallyNeutral.includes(attr));
 console.log('NEUTRAL_CIRCLE_BAND '+JSON.stringify({band:first+'-'+last,attackAttributes:attrs,
  neutralEncounters:entireBand.filter(row=>attrs.some(attr=>Number(row['resist_'+attr])===1)).length,
  totalEncounters:entireBand.length}));
}
console.log('PASS fixed, neutral-first magic circles for complete test sorties');
