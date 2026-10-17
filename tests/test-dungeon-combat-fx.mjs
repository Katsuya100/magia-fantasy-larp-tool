import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {effectCaption,playCombatSequence,playBattleCeremony,simultaneousPhases,effectDuration,COMBAT_EFFECT_MS,ENCOUNTER_EFFECT_MS,treasureChestMarkup,lootCeremonyDuration,bossCeremonyTier,ceremonyDuration,BOSS_CEREMONY_MS} from '../assets/js/dungeon-combat-fx.mjs';
const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,buffs]=await Promise.all(['balance','levels','floors','player-base','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const base={hp:110,mag:12,def:10,res:10};
const s=(role,attribute='flame')=>({role,attribute,power:5000});
const unit=(spells)=>G.makeUnit(base,1,{},spells);
const p=unit([s('support','aqua'),s('defense','law'),s('debuff','bolt'),s('attack')]);
const e=unit([s('attack','flame'),s('debuff','gravity'),s('defense','aqua'),s('support','law')]);
const ordered=(a,b,pi,ei)=>{
 const steps=[];
 const logs=G.round(a,b,pi,ei,buffs,()=>.99,step=>steps.push(step));
 assert.deepEqual(steps.map(x=>x.text),logs,'every timeline frame corresponds to a real log action');
 return steps;
};
p.hp=40;e.hp=75;
let frames=ordered(p,e,0,0);
assert.deepEqual(frames.map(x=>x.role),['support','attack'],'healing resolves before attacking');
assert.deepEqual(frames.map(x=>x.side),['hero','enemy']);
assert.ok(frames[0].hero.hp>40,'heal is visible in first frame');
assert.ok(frames[1].hero.hp<frames[0].hero.hp,'enemy damage appears only in its own later frame');
assert.equal(frames[0].enemy.hp,75,'future attack must not appear early');
assert.equal(frames[1].attribute,'flame');
assert.ok(frames[1].amount>=0);
const q=unit([s('defense','law')]),w=unit([s('debuff','bolt')]);
frames=ordered(q,w,0,0);
assert.deepEqual(frames.map(x=>x.role),['defense','debuff'],'barrier precedes hex');
assert.ok(frames[0].hero.statuses.some(x=>x.kind==='buff'),'defense visual receives its fresh buff snapshot');
assert.equal(frames[0].hero.statuses.some(x=>x.kind==='debuff'),false);
assert.ok(frames[1].hero.statuses.some(x=>x.kind==='debuff'),'hex snapshot shows new status');
const z=unit([s('attack')]),v=unit([s('attack')]);
G.addStatus(z,{id:'test-burning',kind:'debuff',attribute:'flame',effect:'burn',value:.8,turns:2});
frames=ordered(z,v,0,0);
assert.deepEqual(frames.map(x=>x.role),['attack','attack','burn'],'damage-over-time ticks after both attacks');
assert.deepEqual(frames.map(x=>x.side),['hero','enemy','hero']);
assert.equal(frames[2].hero.hp,Math.max(0,frames[1].hero.hp-frames[2].amount));
const l=unit([]),m=unit([]);
frames=ordered(l,m,-1,-1);
assert.deepEqual(frames.map(x=>x.role),['basic','basic']);
assert.equal(frames[0].side,'hero');assert.equal(frames[1].side,'enemy');
assert.match(effectCaption({role:'basic',attribute:'law',amount:4}),/通常攻撃 −4/);
assert.match(effectCaption({role:'defense',attribute:'aqua'}),/防御/);
assert.match(effectCaption({role:'debuff',attribute:'storm'}),/弱体/);
assert.match(effectCaption({role:'buff',attribute:'law'}),/強化/);
assert.match(effectCaption({role:'support',attribute:'aqua',amount:8}),/回復 \+8/);
assert.equal(effectDuration(),0,'without browser motion is disabled');
assert.ok(COMBAT_EFFECT_MS<=480,'combat playback is snappier than before');
assert.ok(ENCOUNTER_EFFECT_MS>COMBAT_EFFECT_MS,'entrance offers a short reading pause');
const originalWindow=globalThis.window;
globalThis.window={matchMedia:()=>({matches:false})};
assert.equal(effectDuration(),COMBAT_EFFECT_MS,'full-motion browser uses the faster timeline');
globalThis.window={matchMedia:()=>({matches:true})};
assert.equal(effectDuration(),0,'reduced-motion skips action delays');
globalThis.window=originalWindow;
const history=[];
assert.deepEqual(simultaneousPhases(frames).map(p=>p.map(s=>s.side)),[['hero','enemy']],'both basic attacks share the same visual phase');
await playCombatSequence(frames,phase=>history.push('paint '+phase.map(s=>s.side).join('+')),{duration:1,wait:async()=>history.push('wait')});
assert.deepEqual(history,['paint hero+enemy','wait'],'both sides paint before one shared wait');
const mixed=[{role:'support',side:'hero'},{role:'defense',side:'enemy'},{role:'attack',side:'hero'},{role:'attack',side:'enemy'},{role:'burn',side:'hero'}];
assert.deepEqual(simultaneousPhases(mixed).map(x=>x.map(s=>s.role+':'+s.side)),[
 ['support:hero'],['defense:enemy'],['attack:hero','attack:enemy'],['burn:hero']
],'combat resolution order is retained and equal priority actions overlap');
const progress=[];
await playCombatSequence(mixed,phase=>progress.push(phase[0].role),{duration:1,wait:async()=>progress.push('wait')});
assert.deepEqual(progress,['support','wait','defense','wait','attack','wait','burn','wait']);
const ceremonyOrder=[];
await playBattleCeremony('loot',event=>ceremonyOrder.push(event),{duration:1,wait:async()=>ceremonyOrder.push('finished')});
assert.deepEqual(ceremonyOrder,['loot','finished']);
assert.equal(simultaneousPhases([]).length,0);
assert.deepEqual(simultaneousPhases([{side:'enemy',role:'attack'}]).length,1);
for(const count of [0,1,2,3,5,10,35]){
 const html=treasureChestMarkup(count);
 assert.equal((html.match(/class="loot-chest"/g)||[]).length,count,'one opening treasure chest per dropped reward');
 assert.equal((html.match(/class="loot-chest-lid"/g)||[]).length,count,'each chest has its own opening lid');
 assert.equal((html.match(/class="loot-chest-light"/g)||[]).length,count,'each chest reveals treasure light');
 assert.ok(lootCeremonyDuration(count)>=1200);
}
assert.throws(()=>treasureChestMarkup(-1),/Invalid drop count/);
assert.throws(()=>treasureChestMarkup(1.5),/Invalid drop count/);
assert.ok(lootCeremonyDuration(35)>lootCeremonyDuration(3),'large drop quantities have time to finish opening');

// Cinematics apply only to the fifth encounter of a layer, never to normal mobs.
for(const [fight,tier] of [[1,'none'],[4,'none'],[5,'boss'],[6,'none'],
 [45,'boss'],[50,'milestone'],[55,'boss'],[95,'boss'],[100,'milestone'],
 [250,'milestone'],[495,'boss'],[500,'final'],[505,'boss'],[550,'milestone']]){
 assert.equal(bossCeremonyTier(fight),tier,'correct boss cinematic tier on fight '+fight);
}
assert.equal(bossCeremonyTier(undefined),'none');
for(const event of ['encounter','enemy-death']){
 const normal=ceremonyDuration(event,1),boss=ceremonyDuration(event,5);
 const decade=ceremonyDuration(event,50),final=ceremonyDuration(event,500);
 assert.equal(normal,event==='encounter'?ENCOUNTER_EFFECT_MS:1120);
 assert.ok(normal<boss&&boss<decade&&decade<final,'ceremony length escalates '+event);
 assert.equal(boss,BOSS_CEREMONY_MS.boss[event]);
 assert.equal(decade,BOSS_CEREMONY_MS.milestone[event]);
 assert.equal(final,BOSS_CEREMONY_MS.final[event]);
 for(const fight of [1,5,50,500])assert.equal(ceremonyDuration(event,fight,{animated:false}),0,'reduced motion has no delay');
}
assert.equal(ceremonyDuration('loot',500,{drops:7}),lootCeremonyDuration(7),'loot retains original animation time');
assert.equal(ceremonyDuration('hero-death',500),1120,'player defeat remains unchanged');
const cinematicCss=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const cinematicPage=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
for(const name of ['boss-vfx-flash','boss-vfx-wheel','boss-vfx-ring','boss-vfx-beam','boss-vfx-sparks'])
 assert.match(cinematicPage,new RegExp('class="[^"]*'+name),'boss ceremony artwork exists: '+name);
for(const tier of ['boss','milestone','final'])
 assert.ok(cinematicCss.includes('[data-boss-tier="'+tier+'"]'),'tier styling exists: '+tier);
assert.match(cinematicCss,/boss-cinematic-shake/,'boss quake is visible');
assert.match(cinematicCss,/#battleArena\[data-boss-ceremony\]:not\(\[data-boss-ceremony="none"\]\) \.versus/,'quake only moves arena badge');
assert.match(cinematicCss,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.boss-ceremony-art\{display:none!important\}/,'boss VFX respect reduced motion');

console.log('PASS concurrent elemental fighter phases, ordered actions, encounter/death/loot and exact number of flying treasure chests');
