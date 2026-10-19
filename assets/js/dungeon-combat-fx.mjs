import {isLayerBoss,layerOfFight} from './dungeon-progress.mjs';
// Visual playback follows the ordered snapshots emitted by dungeon-core.round.
// Animations never alter combat math or determine turn outcomes.
export const EFFECT_LABELS={attack:'⚔️攻撃',basic:'⚔️通常攻撃',defense:'🛡️防御',debuff:'🕸️弱体',support:'✚回復',buff:'強化',burn:'火傷',item:'道具',revive:'復活'};
export const ELEMENT_GLYPHS={flame:'🔥',bolt:'⚡',aqua:'💧',storm:'🌪',gravity:'⬤',law:'⚖',chaos:'☄'};
export function effectCaption(step){
 const tag=EFFECT_LABELS[step.role]||'術式';
 const symbol=ELEMENT_GLYPHS[step.attribute]||'✦';
 const n=Number(step.amount)||0;
 if(step.role==='attack'||step.role==='basic'||step.role==='burn')return symbol+' '+tag+' −'+n;
 if(step.role==='support'||step.role==='item'||step.role==='revive')return symbol+' '+tag+(n?' +'+n:'');
 return symbol+' '+tag;
}
// Individual circle's invested stones (not unspent wallet balance).
// Normal: 0-4; enhanced: 5-19; high: 20-54; ultimate: 55+.
export function magicEffectTier(upgradeLevel,role='attack'){
 if(!['attack','defense','support','debuff'].includes(role))return 1;
 const count=Number(upgradeLevel);
 if(!Number.isSafeInteger(count)||count<5)return 1;
 return count>=55?4:count>=20?3:2;
}
export const COMBAT_EFFECT_MS=440;
export const ENCOUNTER_EFFECT_MS=820;
/* Only every fifth encounter is a layer boss; every tenth layer gains a
   second VFX tier and the designed 100th-layer boss gets the finale. */
export const BOSS_CEREMONY_MS=Object.freeze({
 boss:Object.freeze({encounter:1800,'enemy-death':2150}),
 milestone:Object.freeze({encounter:2650,'enemy-death':3100}),
 final:Object.freeze({encounter:3800,'enemy-death':4500})
});
export function bossCeremonyTier(fight){
 if(!isLayerBoss(fight))return 'none';
 const layer=layerOfFight(fight);
 return layer===100?'final':layer%10===0?'milestone':'boss';
}
export function ceremonyDuration(event,fight,{animated=true,drops=0}={}){
 if(!animated)return 0;
 if(event==='loot')return lootCeremonyDuration(drops);
 const boss=BOSS_CEREMONY_MS[bossCeremonyTier(fight)];
 if(boss?.[event])return boss[event];
 return event==='encounter'?ENCOUNTER_EFFECT_MS:1120;
}

export function effectDuration(){
 // Keep reduced-motion users and headless test environments from waiting for animations.
 if(typeof window==='undefined'||typeof window.matchMedia!=='function')return 0;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:COMBAT_EFFECT_MS;
}
// Resolve order is fixed by the combat core. The two sides animate together
// if they acted in the same priority phase, without skipping later phases.
export function simultaneousPhases(steps){
 const phases=[];
 for(const step of steps){
  const last=phases.at(-1);
  if(last&&last[0].role===step.role&&last.every(s=>s.side!==step.side))last.push(step);
  else phases.push([step]);
 }
 return phases;
}
export function fatalSide(phase){
 const last=phase.at(-1);
 if(!last)return null;
 if(last.hero?.hp<=0)return 'hero';
 if(last.enemy?.hp<=0)return 'enemy';
 return null;
}
// Start the death effect before the fatal attack animation ends.
export async function playCombatSequence(steps,paint,{
 duration=effectDuration(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 onFatal=null,overlap=125
}={}){
 let death=null;
 for(const phase of simultaneousPhases(steps)){
  paint(phase);
  const fatal=onFatal&&!death?fatalSide(phase):null;
  if(fatal){
   const lead=Math.max(0,duration-overlap);
   if(lead>0)await wait(lead);
   death=Promise.resolve(onFatal(fatal,phase));
   if(duration-lead>0)await wait(duration-lead);
  }else if(duration>0)await wait(duration);
 }
 if(death)await death;
}
// One visible chest represents exactly one actual drop, including identical items.
export function treasureChestMarkup(count){
 if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid drop count');
 return Array.from({length:count},(_,i)=>'<span class="loot-chest" style="--chest-delay:'+(i*0.035).toFixed(3)+'s" aria-hidden="true"><span class="loot-chest-lid"></span><span class="loot-chest-body"></span><span class="loot-chest-light"></span></span>').join('');
}
export function lootCeremonyDuration(count){
 return 1200+Math.max(0,count-1)*35;
}
export async function playBattleCeremony(event,paint,{duration=effectDuration(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 paint(event);
 if(duration>0)await wait(duration);
}
