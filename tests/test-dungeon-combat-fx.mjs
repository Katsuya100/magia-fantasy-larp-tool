import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {magicEffectTier,effectCaption,attackHitAffinity,playCombatSequence,playBattleCeremony,simultaneousPhases,effectDuration,combatPhaseDuration,combatPhaseAdvanceDuration,COMBAT_EFFECT_MS,AFFINITY_EFFECT_MS,ENCOUNTER_EFFECT_MS,treasureChestMarkup,lootCeremonyDuration,bossCeremonyTier,ceremonyDuration,BOSS_CEREMONY_MS,FINAL_CLEAR_EFFECT_MS} from '../assets/js/dungeon-combat-fx.mjs';
import {captureCombatFxEcho} from '../assets/js/dungeon-combat-fx-echo.mjs';

// Muse #8: an old "+118" healing caption must not linger as a visible echo
// while the new combat phase already displays a different HP value.
function mockFxNode(id='',text=''){
 const node={id,textContent:text,children:[],style:{},dataset:{},
  setAttribute(){},removeAttribute(key){if(key==='id')this.id='';},remove(){this.removed=true;},
  append(...children){this.children.push(...children);},
  cloneNode(deep){const copy=mockFxNode(this.id,this.textContent);if(deep)copy.children=this.children.map(x=>x.cloneNode(true));return copy;},
  querySelectorAll(selector){const matching=[];const visit=x=>{for(const child of x.children){if(selector==='[id]'&&child.id||selector==='strong'&&child.tag==='strong')matching.push(child);visit(child);}};visit(this);return matching;}
 };
 return node;
}
const oldDocument=globalThis.document;
try{
 globalThis.document={createElement:()=>mockFxNode()};
 const makeActor=(message)=>{
  const caption=mockFxNode('heroFxText',message);caption.tag='strong';
  const fx=mockFxNode();fx.children.push(caption);
  return {offsetLeft:0,offsetTop:0,offsetWidth:100,offsetHeight:100,
   cloneNode:()=>mockFxNode(),querySelector:query=>query==='.combatant-fx'?fx:null};
 };
 const actors={'#heroCombatant':makeActor('💧 ✚回復 +118'),'#enemyCombatant':makeActor('')};
 const arena={children:[],querySelector:query=>actors[query]||null,append(node){this.children.push(node);}};
 const oldEcho=captureCombatFxEcho(arena,440);
 assert.ok(oldEcho,'real combat FX captures a visual echo');
 oldEcho.reveal();
 const echoedCaptions=arena.children[0].children.flatMap(actor=>actor.children.flatMap(fx=>fx.children));
 assert.ok(echoedCaptions.length,'the echo contains the captured healing FX node');
 assert.equal(echoedCaptions[1].textContent,'',
  'REPRO Muse #8: obsolete +118 healing caption must not overlay the next HP snapshot');
 oldEcho.dispose();
}finally{globalThis.document=oldDocument;}

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
// Affinity visual tests cover both sides, neutral hits, misses, and buffs.
const affinityHero=unit([]);
const affinityEnemy=G.makeUnit(base,1,{flame:.5},[],'enemy');
const affinityHit={side:'hero',role:'attack',attribute:'flame',amount:12,hero:affinityHero,enemy:affinityEnemy};
assert.equal(attackHitAffinity(affinityHit),'resist');
assert.equal(attackHitAffinity({...affinityHit,enemy:G.makeUnit(base,1,{flame:1.5},[],'enemy')}),'weak');
assert.equal(attackHitAffinity({...affinityHit,enemy:unit([])}),'none');
assert.equal(attackHitAffinity({...affinityHit,amount:0}),'none','misses must not show affinity');
assert.equal(attackHitAffinity({...affinityHit,role:'basic'}),'none','basic damage ignores elemental resistance');
assert.equal(attackHitAffinity({...affinityHit,role:'debuff'}),'none','curses do not trigger the attack FX');
assert.equal(attackHitAffinity({...affinityHit,side:'enemy',hero:G.makeUnit(base,1,{flame:1.6},[],'player')}),'weak','enemy magic hits work too');
const shielded=unit([]);
G.addStatus(shielded,{id:'resist_flame',kind:'buff',attribute:'flame',effect:'resist',value:.4,turns:2});
assert.equal(attackHitAffinity({...affinityHit,enemy:shielded}),'resist','temporary resistance is reflected');
assert.equal(attackHitAffinity({...affinityHit,enemy:{}}),'none','incomplete visual frames are safe');
assert.equal(AFFINITY_EFFECT_MS,720,'the whole affinity hit lasts 720ms');
assert.equal(combatPhaseDuration([affinityHit],COMBAT_EFFECT_MS),AFFINITY_EFFECT_MS,'resistance extends impact');
assert.equal(combatPhaseDuration([{...affinityHit,enemy:G.makeUnit(base,1,{flame:1.5},[],'enemy')}],COMBAT_EFFECT_MS),AFFINITY_EFFECT_MS,'weakness extends impact');
assert.equal(combatPhaseDuration([{...affinityHit,amount:0}],COMBAT_EFFECT_MS),COMBAT_EFFECT_MS,'miss keeps normal tempo');
assert.equal(combatPhaseDuration([{...affinityHit,role:'basic'}],COMBAT_EFFECT_MS),COMBAT_EFFECT_MS,'basic attacks keep normal tempo');
assert.equal(combatPhaseDuration([{...affinityHit,enemy:unit([])}],COMBAT_EFFECT_MS),COMBAT_EFFECT_MS,'neutral attacks keep normal tempo');
assert.equal(combatPhaseDuration([affinityHit],0),0,'reduced motion stays instant');
assert.equal(combatPhaseAdvanceDuration([affinityHit],COMBAT_EFFECT_MS),COMBAT_EFFECT_MS,'RESIST can yield at 440ms while 720ms art remains');
assert.equal(combatPhaseAdvanceDuration([{...affinityHit,enemy:G.makeUnit(base,1,{flame:1.5},[],'enemy')}],COMBAT_EFFECT_MS),COMBAT_EFFECT_MS,'WEAK also advances at 440ms');
const affinityWaits=[];
await playCombatSequence([affinityHit],()=>{}, {duration:COMBAT_EFFECT_MS,wait:async ms=>affinityWaits.push(ms)});
assert.deepEqual(affinityWaits,[COMBAT_EFFECT_MS],'affinity playback waits only for the base phase, not 720ms');
// Strict boundaries for 3 ultimate circles at 55 spent stones each (165 total).
for(const [stones,expected] of [[0,1],[4,1],[5,2],[19,2],[20,3],[54,3],[55,4],[100,4]]){
 for(const role of ['attack','defense','support','debuff'])
  assert.equal(magicEffectTier(stones,role),expected,role+' tier at '+stones);
}
for(const value of [undefined,null,-1,2.5,NaN,Infinity,'not-a-stone'])
 assert.equal(magicEffectTier(value),1,'invalid investment is safe');
for(const role of ['basic','burn','item','buff','revive'])
 assert.equal(magicEffectTier(55,role),1,role+' never upgrades animation');
const magicHero=unit([{...s('attack'),upgradeLevel:55}]);
const magicEnemy=unit([{...s('attack','bolt'),upgradeLevel:20}]);
const dual=ordered(magicHero,magicEnemy,0,0);
assert.deepEqual(dual.slice(0,2).map(x=>[x.side,x.upgradeLevel]),[['hero',55],['enemy',20]],
 'simultaneous magic casts keep their own upgrade level');
assert.deepEqual(dual.slice(0,2).map(x=>magicEffectTier(x.upgradeLevel,x.role)),[4,3]);
const simple=unit([s('attack')]),upgradedVisual=unit([{...s('attack'),upgradeLevel:55}]);
const foe1=unit([]),foe2=unit([]);
const originalDamage=ordered(simple,foe1,0,-1)[0].amount;
const tieredDamage=ordered(upgradedVisual,foe2,0,-1)[0].amount;
assert.equal(tieredDamage,originalDamage,'visual investment alone never alters damage');
const withoutMagic=ordered(unit([]),unit([]),-1,-1);
assert.ok(withoutMagic.every(x=>x.upgradeLevel===0),'basic attacks stay tier I');
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
const arenaMarkup=cinematicPage.slice(cinematicPage.indexOf('id="battleArena"'),cinematicPage.indexOf('id="battleInfo"'));
assert.equal((arenaMarkup.match(/class="affinity-hit"/g)||[]).length,2,'one hit FX per combatant');
assert.match(cinematicCss,/data-affinity="resist"/,'resistance shield styling');
assert.match(cinematicCss,/data-affinity="weak"/,'weakness burst styling');
assert.match(cinematicCss,/\.unit\[data-affinity="weak"\] \.affinity-hit::before\{[\s\S]*?radial-gradient\(circle[\s\S]*?animation:weak-shockwave \.45s/,'weakness shockwave finishes in 450ms');
assert.match(cinematicCss,/\.unit\[data-affinity="weak"\] \.affinity-hit::after\{[\s\S]*?animation:weak-damped-shudder \.72s linear both,combat-sine-shake \.08s linear var\(--shake-phase,0ms\) infinite,combat-shake-envelope \.72s linear both/,'WEAK retains its 720ms visual duration and gains 10% damping');
const weakShake=cinematicCss.match(/@keyframes weak-damped-shudder\{([\s\S]*?)\n\}/)?.[1];
assert.ok(weakShake,'WEAK opacity/scale envelope exists');
assert.doesNotMatch(weakShake,/translate\(-?\d+px/,'WEAK has no extra slow horizontal vibration');
assert.match(weakShake,/66%,86%\{opacity:1;transform:translate\(-50%,-50%\)\}/,'WEAK settles completely before fading');
assert.match(cinematicCss,/@keyframes weak-shockwave\{[\s\S]*?scale\(\.2\)[\s\S]*?scale\(3\.2\)/,'shockwave expands as it fades');
assert.match(cinematicCss,/\.affinity-hit::before\{\s*animation:affinity-ring \.6s/,'resistance shield lasts 600ms');
assert.match(cinematicCss,/\.affinity-hit::after\{\s*animation:affinity-word \.72s/,'resistance text remains visible for 720ms');
assert.match(cinematicCss,/\.unit\[data-affinity="weak"\] \.affinity-hit::after\{[\s\S]*?animation:weak-damped-shudder \.72s/,'WEAK text and damping remain at 720ms');
assert.match(cinematicCss,/\.unit\[data-affinity="weak"\] \.combatant-fx::before\{\s*animation-duration:\.45s/,'weakness impact glow finishes with shockwave');
assert.match(cinematicCss,/\.unit\[data-affinity="resist"\] \.combatant-fx::before\{\s*animation-duration:\.6s/,'resistance impact glow finishes with shield');
assert.match(cinematicCss,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?affinity-hit::before/,'motion-safe affinity');
for(const name of ['tier-seal','tier-halo','tier-shards']){
 assert.equal((arenaMarkup.match(new RegExp('class="'+name+'"','g'))||[]).length,4,
  'each decorative tier layer exists for both combatants and both projectiles: '+name);
}
for(const tier of [2,3,4]){
 assert.ok(cinematicCss.includes('[data-tier="'+tier+'"]'),'enhancement tier styling '+tier);
}
assert.match(cinematicCss,/\[data-incoming-tier="4"\]/,'ultimate damage has its own impact');
assert.match(cinematicCss,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?tier-seal/,'tiered artwork is motion-safe');
const appSource=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const liveRelease=cinematicPage.match(/data-release="(\d{8}\.\d+)"/)?.[1];
assert.ok(liveRelease,'the release marker exists in HTML');
const sharedRelease=appSource.match(/dungeon-core\.mjs\?v=(\d{8}\.\d+)/)?.[1];
assert.ok(sharedRelease,'the unchanged dungeon modules retain a shared cache version');
assert.ok(appSource.includes('dungeon-combat-fx.mjs?v='+liveRelease),'changed FX module uses the release cache version');
assert.match(appSource,/projectile\.dataset\.tier=actor\.dataset\.tier/,'attack projectiles use caster investment');
assert.match(appSource,/target\.dataset\.affinity='none'/,'affinity resets');
assert.match(appSource,/onFatal:side=>\{[\s\S]*?disposeCombatEchoes\(\$\('battleArena'\),activeEchoes\);[\s\S]*?clearCombatEffects\(\);[\s\S]*?return ceremony\(/,
 'a fatal result destroys echoes from all phases and previous turns before death ceremony');
assert.match(appSource,/victim\.dataset\.affinity=attackHitAffinity\(step\)/,'attack uses true resistance');
assert.match(appSource,/victim\.dataset\.incomingAttribute=/,'dual casts keep the incoming attribute independent');
assert.match(cinematicCss,/--impact-color/,'incoming projectile controls impact hue');
assert.match(appSource,/victim\.dataset\.incomingTier=String\(magicEffectTier\(step\.upgradeLevel,step\.role\)\)/,
 'incoming force comes from opponent cast, not victim investment');
assert.match(appSource,/target\.dataset\.tier='1'/,'cast animation is reset between phases');
assert.match(appSource,/activeSpells\[index\]\.upgradeLevel=/,'saved expeditions recover their investment');
for(const name of ['boss-vfx-flash','boss-vfx-wheel','boss-vfx-ring','boss-vfx-beam','boss-vfx-sparks'])
 assert.match(cinematicPage,new RegExp('class="[^"]*'+name),'boss ceremony artwork exists: '+name);
for(const tier of ['boss','milestone','final'])
 assert.ok(cinematicCss.includes('[data-boss-tier="'+tier+'"]'),'tier styling exists: '+tier);
const sineShake=cinematicCss.match(/@keyframes combat-sine-shake\{([\s\S]*?)\n\}/)?.[1];
assert.ok(sineShake,'sine-like common wave exists');
assert.match(sineShake,/0%,50%,100%\{translate:0 0\}/,'wave crosses zero twice per period');
assert.match(sineShake,/25%\{translate:calc\(var\(--shake-x\) \* var\(--shake-direction,1\) \* var\(--shake-gain\)\)/,'direction and gain control positive peak');
assert.match(sineShake,/75%\{translate:calc\(var\(--shake-x\) \* var\(--shake-direction,1\) \* var\(--shake-gain\) \* -1\)/,'reverse wave peak');
assert.match(sineShake,/12\.5%,37\.5%\{translate:calc\([\s\S]*?\* \.7071\)/,'sine-like rounded positive half-cycle');
assert.match(sineShake,/62\.5%,87\.5%\{translate:calc\([\s\S]*?\* -\.7071\)/,'sine-like rounded negative half-cycle');
assert.match(cinematicCss,/@property --shake-gain\{\s*syntax:"<number>";\s*inherits:false;\s*initial-value:1/,'gain interpolates as a number');
const envelope=cinematicCss.match(/@keyframes combat-shake-envelope\{([\s\S]*?)\n\}/)?.[1];
assert.ok(envelope,'all waves use a damping envelope');
assert.match(envelope,/0%,90%\{--shake-gain:1\}/,'full strength until final 10%');
assert.match(envelope,/100%\{--shake-gain:0\}/,'vibration decays to zero at end');
const shakeRule=selector=>{
 // Prefer the later override when a generic selector precedes its hit-specific rule.
 const i=cinematicCss.lastIndexOf(selector+'{');
 assert.ok(i>=0,'expected shake component: '+selector);
 return cinematicCss.slice(i,cinematicCss.indexOf('}',i)+1);
};
for(const [selector,period,duration] of [
 ['#battleArena[data-shake="true"] .versus','.1s','.44s'],
 ['#battleArena .unit[data-hit="true"]:not([data-effect="attack"]):not([data-effect="basic"])','.095s','.44s'],
 ['#battleArena .hero-unit[data-hit="true"]:not([data-effect="attack"]):not([data-effect="basic"])','.085s','.44s'],
 ['#battleArena .hero-unit:is([data-effect="attack"],[data-effect="basic"])[data-hit="true"]','.085s','.44s'],
 ['#battleArena .enemy-unit:is([data-effect="attack"],[data-effect="basic"])[data-hit="true"]','.105s','.44s'],
 ['#battleArena .unit[data-affinity="weak"] .affinity-hit::after','.08s','.72s'],
 ['#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .versus','.1s','var(--boss-time,2s)'],
 ['#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"])[data-ceremony-event="encounter"] .versus','.17s','var(--boss-time,2s)'],
 ['#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .enemy-unit[data-entering="true"]','.18s','var(--boss-time,2s)'],
 ['#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .enemy-unit[data-dying="true"]','.09s','var(--boss-time,2s)']
]){
 const rule=shakeRule(selector);
 assert.ok(rule.includes('combat-sine-shake '+period+' linear var(--shake-phase,0ms) infinite'),
   'independent period and initial phase for '+selector);
 assert.ok(rule.includes('combat-shake-envelope '+duration+' linear both'),
   'final 10% damping within original duration for '+selector);
}
assert.match(shakeRule('#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"])[data-ceremony-event="encounter"] .versus'),/--shake-x:calc\(var\(--boss-jolt\) \* \.22\)/,'boss appearance badge has reduced amplitude');
assert.match(shakeRule('#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .enemy-unit[data-entering="true"]'),/--shake-x:calc\(var\(--boss-jolt\) \* \.16\)/,'boss appearance body has reduced amplitude');
assert.match(appSource,/function randomizeCombatShake\(arena\)\{[\s\S]*?\.versus,\.hero-unit,\.enemy-unit,\.affinity-hit/,'each part randomized individually');
assert.match(appSource,/crypto\?\.getRandomValues/,'visual randomization does not disturb combat RNG');
const shakeRandomSource=appSource.slice(appSource.indexOf('function randomizeCombatShake('),appSource.indexOf('function clearCombatEffects('));
assert.doesNotMatch(shakeRandomSource,/Math\.random\(/,'visual-only phase fallback never consumes combat/drop RNG');
assert.match(shakeRandomSource,/shakeSceneNonce/,'visual-only fallback varies between scenes');
assert.match(appSource,/setProperty\('--shake-phase'/,'part wave starting phase randomized');
assert.match(appSource,/setProperty\('--shake-direction'/,'part wave starting direction randomized');
assert.match(appSource,/clearCombatEffects\(\);\s*randomizeCombatShake\(\$\('battleArena'\)\)/,'per-attack phase randomization');
assert.match(appSource,/if\(tier!=='none'\)randomizeCombatShake\(arena\)/,'boss scene randomization');
assert.equal(COMBAT_EFFECT_MS,440,'original base duration preserved');
assert.equal(AFFINITY_EFFECT_MS,720,'WEAK visual duration preserved');
const weakSample={...affinityHit,enemy:G.makeUnit(base,1,{flame:1.5},[],'enemy')};
const weakWaits=[];
await playCombatSequence([weakSample],()=>{}, {duration:COMBAT_EFFECT_MS,wait:async ms=>weakWaits.push(ms)});
assert.deepEqual(weakWaits,[440],'WEAK effect does not cause an extra wait even with damping');
assert.doesNotMatch(cinematicCss,/@keyframes boss-cinematic-shake|@keyframes snappy-screen-shake/,'old slow/irregular shake keyframes are removed');
assert.equal(BOSS_CEREMONY_MS.final['enemy-death'],4500,'100F defeat alone lasts the full 4.5s');
assert.equal(BOSS_CEREMONY_MS.final['enemy-death']+FINAL_CLEAR_EFFECT_MS,5350,'independent CLEAR follows the full 4.5s defeat');
assert.match(cinematicCss,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.boss-ceremony-art\{display:none!important\}/,'boss VFX respect reduced motion');

// Scene orientation is presentation-only: actor IDs and their effect targets remain stable.
assert.deepEqual([...arenaMarkup.matchAll(/<article id="(hero|enemy)Combatant"/g)].map(match=>match[1]),
 ['hero','enemy'],'hero is on the left and enemy on the right');
for(const id of ['heroProjectile','enemyProjectile','heroStats','enemyStats','heroFxText','enemyFxText']){
 assert.equal(arenaMarkup.split('id="'+id+'"').length-1,1,'retained actor effect target '+id);
}
const orientationFrame=name=>{
 const begin=cinematicCss.indexOf('@keyframes '+name+'{');
 assert.ok(begin>=0,'missing '+name);
 return cinematicCss.slice(begin,cinematicCss.indexOf('\n}',begin)+2);
};
assert.ok(orientationFrame('snappy-rush-hero').includes('translateX(34px)'),'hero attacks toward right');
assert.ok(orientationFrame('snappy-rush-enemy').includes('translateX(-34px)'),'enemy attacks toward left');
assert.ok(cinematicCss.includes('[data-side="hero"] .hero-unit{animation:fx-rush-right'),'legacy hero rush faces right');
assert.ok(cinematicCss.includes('[data-side="enemy"] .enemy-unit{animation:fx-rush-left'),'legacy enemy rush faces left');
assert.ok(cinematicCss.includes('.hero-unit:is([data-effect="attack"],[data-effect="basic"])[data-hit="true"]{animation:fx-rush-right'),'hero dual-hit faces right');
assert.ok(cinematicCss.includes('.enemy-unit:is([data-effect="attack"],[data-effect="basic"])[data-hit="true"]{animation:fx-rush-left'),'enemy dual-hit faces left');
assert.ok(orientationFrame('enemy-snap-slide').includes('translate(48px,0)'),'ordinary enemy enters from right');
assert.ok(orientationFrame('boss-cinematic-rise').includes('translateY(38px)'),'boss fades and rises from below');
assert.doesNotMatch(orientationFrame('boss-cinematic-rise'),/translateX\(/,'boss entrance has no horizontal slide');
assert.match(orientationFrame('boss-cinematic-rise'),/18%\{opacity:\.4;transform:translateY\(26px\)/,'boss gradually fades in while ascending');
assert.match(orientationFrame('enemy-snap-slide'),/55%\{opacity:1;transform:translate\(16px,-24px\)/,'ordinary enemies jump in an upward arc');
assert.match(orientationFrame('enemy-snap-slide'),/92%\{opacity:1;transform:translate\(0,2px\)/,'ordinary enemies lightly compress on landing');
assert.match(orientationFrame('enemy-snap-slide'),/100%\{opacity:1;transform:translate\(0,0\)/,'ordinary enemies settle without sideways rebound');
assert.doesNotMatch(orientationFrame('enemy-snap-slide'),/translateX\(-|translate\(-/,'ordinary enemy never overshoots sideways');
assert.doesNotMatch(shakeRule('#battleArena .enemy-unit[data-entering="true"]'),/combat-sine-shake/,'normal enemies enter with no vibration');
assert.match(shakeRule('#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .enemy-unit[data-entering="true"]'),/combat-sine-shake \.18s/,'bosses vibrate subtly as they rise');

// Only 100F defeat has four strictly timed phases, followed by a separate CLEAR.
const finalDefeat='#battleArena[data-boss-ceremony="final"][data-ceremony-event="enemy-death"] .enemy-unit[data-dying="true"]';
const finalBossRule=shakeRule(finalDefeat);
assert.match(shakeRule('#battleArena[data-boss-ceremony="final"][data-ceremony-event="enemy-death"]'),/--boss-time:4\.5s/,'CSS boss timeline matches the full 4.5s JS defeat');
assert.equal(2000+500+1000+1000,4500,'four final boss defeat stages last 4.5s independently of CLEAR');
assert.match(finalBossRule,/animation:boss-final-implosion var\(--boss-time,4\.5s\)/,'4.5s defeat uses the special scale animation');
assert.match(finalBossRule,/boss-final-shake-envelope var\(--boss-time,4\.5s\)/,'shake envelope stays within the first defeat phase');
assert.match(shakeRule('#battleArena[data-boss-ceremony]:not([data-boss-ceremony="none"]) .enemy-unit[data-dying="true"]'),/animation:boss-cinematic-collapse/,'regular and milestone bosses retain shared defeat animation');
for(const [part,motion] of [
 ['boss-vfx-halo','boss-final-halo-pulse'],
 ['boss-vfx-ring-outer','boss-final-ring-burst-outer'],
 ['boss-vfx-ring-inner','boss-final-ring-burst-inner'],
 ['boss-vfx-wheel','boss-final-ring-burst-wheel'],
 ['boss-vfx-flash','boss-final-flash'],
 ['boss-vfx-beam','boss-final-beam-collapse'],
 ['boss-vfx-sparks','boss-final-particles']
]){
 const selector='#battleArena .battle-ceremony[data-boss-tier="final"][data-event="enemy-death"] .'+part;
 assert.match(shakeRule(selector),new RegExp('animation:'+motion+' var\\(--ceremony-duration,4\\.5s\\)'),'finale particles stay within the 4.5s defeat segment: '+part);
}
const finalFrames=orientationFrame('boss-final-implosion');
assert.match(finalFrames,/44\.444%\{opacity:\.5;transform:scale\(1\)/,'phase 1: at 2s boss is half-transparent');
assert.match(finalFrames,/55\.556%\{opacity:\.5;transform:scale\(0\)/,'phase 2: at 2.5s boss shrinks out');
assert.match(finalFrames,/77\.778%\{opacity:0;transform:scale\(2\)/,'phase 3: at 3.5s boss expands to twofold scale');
const shakeEnd=orientationFrame('boss-final-shake-envelope');
assert.match(shakeEnd,/0%,40%\{--shake-gain:1\}/,'shake remains full until 1.8s');
assert.match(shakeEnd,/44\.444%,100%\{--shake-gain:0\}/,'shake dampens during the last 10% of phase 1');
const halo=orientationFrame('boss-final-halo-pulse');
assert.match(halo,/0%,44\.444%\{opacity:0/,'halo appears only once shrink begins');
assert.match(halo,/50%\{opacity:1/,'halo fades in while boss collapses');
assert.match(halo,/55\.556%,100%\{opacity:0/,'halo fades out within the half-second shrink');
for(const name of ['boss-final-ring-burst-outer','boss-final-ring-burst-inner','boss-final-ring-burst-wheel']){
 const ring=orientationFrame(name);
 assert.match(ring,/0%,55\.556%\{opacity:0/,'ring starts at the beginning of phase 3: '+name);
 assert.match(ring,/77\.778%,100%\{opacity:0/,'ring has vanished by the beginning of phase 4: '+name);
}
const whiteout=orientationFrame('boss-final-whiteout');
assert.match(whiteout,/77\.778%\{opacity:1\}/,'whiteout peaks at 3.5 seconds');
assert.match(whiteout,/100%\{opacity:0\}/,'white-in completes before CLEAR');
const particles=orientationFrame('boss-final-particles');
assert.match(particles,/0%,77\.778%\{opacity:0/,'particles only begin after whiteout peaks');
assert.match(particles,/100%\{opacity:0/,'particles finish at 4.5 seconds before CLEAR');
assert.match(shakeRule('#battleArena .battle-ceremony[data-boss-tier="final"][data-event="enemy-death"]::after'),/boss-final-whiteout var\(--ceremony-duration,4\.5s\)/,'whiteout stays inside the defeat segment and arena');
assert.match(shakeRule('#battleArena .battle-ceremony[data-event="final-clear"]'),/animation:boss-final-clear-veil/,'CLEAR uses a distinct scene after the finale');
assert.match(shakeRule('#battleArena .battle-ceremony[data-event="final-clear"]>strong'),/animation:boss-final-clear-title/,'CLEAR title has an independent appearance animation');
assert.match(cinematicCss,/data-boss-tier="final"\]\[data-event="enemy-death"\]>strong,[\s\S]*?visibility:hidden/,'CLEAR text is hidden during all four defeat phases');
assert.match(appSource,/onFatal:side=>\{[\s\S]*?return ceremony\([\s\S]*?\)\.then\(\(\)=>\{[\s\S]*?if\(side==='enemy'&&bossCeremonyTier\(profile\.run\?\.floor\)==='final'\)[\s\S]*?return ceremony\('final-clear','100層 完全制覇'\)/,'only a 100F victory chains CLEAR after the full defeat');
assert.match(appSource,/await animateBattle\(steps,[\s\S]*?if\(run\.enemy\.hp<=0\)\{[\s\S]*?await ceremony\('loot'/,'battle death and CLEAR finish before the existing loot sequence');
assert.match(appSource,/if\(firstHundredClear\)run\.creatorCongratulationsPending=true;[\s\S]*?if\(run\.creatorCongratulationsPending\)showCreatorCongratulations\(\)/,'preexisting 100F congratulation message remains available');
assert.match(appSource,/side==='hero'\?'探索失敗':'討伐成功'/,'pre-loot victory message is preserved');
assert.equal(BOSS_CEREMONY_MS.final['enemy-death'],4500,'four defeat phases end when particles finish at 4.5s');
assert.equal(FINAL_CLEAR_EFFECT_MS,850,'CLEAR cue lasts .85s after particles');
assert.equal(BOSS_CEREMONY_MS.final['enemy-death']+FINAL_CLEAR_EFFECT_MS,5350,'CLEAR begins only after the full four-and-a-half-second defeat');
const finaleOrder=[];
for(const event of ['enemy-death','final-clear']){
 await playBattleCeremony(event,type=>finaleOrder.push(type),{duration:ceremonyDuration(event,500),wait:async ms=>finaleOrder.push(ms)});
}
assert.deepEqual(finaleOrder,['enemy-death',4500,'final-clear',850],'defeat ends before CLEAR begins without an extra wait');
assert.equal(ceremonyDuration('final-clear',500),FINAL_CLEAR_EFFECT_MS,'separate CLEAR uses its own duration');
assert.equal(ceremonyDuration('final-clear',500,{animated:false}),0,'reduced motion does not wait for CLEAR');
assert.match(shakeRule('#battleArena .battle-ceremony[data-boss-tier]:not([data-boss-tier="none"])>strong'),/animation:boss-title-pulse/,'ordinary bosses retain their original victory title');
const ceremonyMarkup=cinematicPage.slice(cinematicPage.indexOf('id="battleCeremony"'),cinematicPage.indexOf('id="heroCombatant"'));
for(const part of ['boss-vfx-ring-outer','boss-vfx-ring-inner','boss-vfx-wheel'])
 assert.match(ceremonyMarkup,new RegExp('class="[^"]*'+part),'each independently bursting ring is already in the scene: '+part);
assert.equal(BOSS_CEREMONY_MS.final['encounter'],3800,'final boss entrance duration stays unchanged');
assert.equal(BOSS_CEREMONY_MS.milestone['enemy-death'],3100,'milestone boss defeat duration stays unchanged');

assert.ok(cinematicCss.includes('transform:translate(36px,-110px) rotate(32deg)'),'enemy-side loot flies from right');
const flightStart=cinematicCss.indexOf('/* Magic attack travels from the center');
const flightEnd=cinematicCss.indexOf('/* Layer boss cinematics',flightStart);
const normalizedFlight=cinematicCss.slice(flightStart,flightEnd).replace(/\s+/g,'');
assert.ok(normalizedFlight.includes('--flight-from:calc(75%+23.5px);--flight-to:calc(25%-23.5px)'),'desktop enemy projectile flies left');
assert.ok(normalizedFlight.includes('[data-side="hero"]{--flight-from:calc(25%-23.5px);--flight-to:calc(75%+23.5px)'),'desktop hero projectile flies right');
assert.ok(normalizedFlight.includes('--flight-from:calc(75%+11.25px);--flight-to:calc(25%-11.25px)'),'mobile enemy projectile flies left');
assert.ok(normalizedFlight.includes('[data-side="hero"]{--flight-from:calc(25%-11.25px);--flight-to:calc(75%+11.25px)'),'mobile hero projectile flies right');

console.log('PASS concurrent elemental fighter phases, ordered actions, encounter/death/loot and exact number of flying treasure chests');
