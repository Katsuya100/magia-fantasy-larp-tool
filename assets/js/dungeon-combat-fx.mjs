import {isLayerBoss,layerOfFight} from './dungeon-progress.mjs';
import {resist} from './dungeon-core.mjs';
// Visual playback follows the ordered snapshots emitted by dungeon-core.round.
// Animations never alter combat math or determine turn outcomes.
export const EFFECT_LABELS={attack:'⚔️攻撃',basic:'⚔️通常攻撃',defense:'🛡️防御',debuff:'🕸️弱体',support:'✚回復',buff:'強化',burn:'火傷',item:'道具',revive:'復活'};
export const ELEMENT_GLYPHS={flame:'🔥',bolt:'⚡',aqua:'💧',storm:'🌪',gravity:'⬤',law:'⚖',chaos:'☄'};
export function effectCaption(step){
 if(step.missedByDizziness===true&&['attack','basic'].includes(step.role))return 'MISS';
 const tag=EFFECT_LABELS[step.role]||'術式';
 const symbol=ELEMENT_GLYPHS[step.attribute]||'✦';
 const n=Number(step.amount)||0;
 if(step.role==='attack'||step.role==='basic'||step.role==='burn')return symbol+' '+tag+' −'+n;
 if(step.role==='support'||step.role==='item'||step.role==='revive')return symbol+' '+tag+(n?' +'+n:'');
 return symbol+' '+tag;
}
// Classify only landed magic attacks. The combat core already uses the same
// effective multiplier (including temporary resistance and vulnerability).
export function attackHitAffinity(step){
 if(step?.role!=='attack'||step.missedByDizziness===true||!(step.amount>0))return 'none';
 const target=step.side==='hero'?step.enemy:step.side==='enemy'?step.hero:null;
 if(!target?.resists)return 'none';
 const value=resist(target,step.attribute);
 return value<1-0.000001?'resist':value>1+0.000001?'weak':'none';
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
export const ENEMY_FINISH_HIT_STOP_MS=110;
export const AFFINITY_EFFECT_MS=720;
export const ENCOUNTER_EFFECT_MS=820;
export const FINAL_CLEAR_EFFECT_MS=2400; // Separate 2.4s victory title after the 5.7s final defeat.
/* Only every fifth encounter is a layer boss; every tenth layer gains a
   second VFX tier and the designed 100th-layer boss gets the finale. */
// 100F defeat phases total 5.7s, including whiteout and drifting scales; CLEAR follows.
// Ordinary boss entrance is 1.65s; all other boss durations stay unchanged.
export const BOSS_CEREMONY_MS=Object.freeze({
 boss:Object.freeze({encounter:1650,'enemy-death':2150}),
 milestone:Object.freeze({encounter:2650,'enemy-death':3100}),
 final:Object.freeze({encounter:3800,'enemy-death':5700})
});
export function bossCeremonyTier(fight){
 if(!isLayerBoss(fight))return 'none';
 const layer=layerOfFight(fight);
 return layer===100?'final':layer%10===0?'milestone':'boss';
}
export function ceremonyDuration(event,fight,{animated=true,drops=0}={}){
 if(!animated)return 0;
 if(event==='final-clear')return FINAL_CLEAR_EFFECT_MS;
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
// Only elemental resistance/weakness hits hold the arena longer. Normal combat
// and reduced-motion playback retain their existing timing.
export function combatPhaseDuration(phase,duration=effectDuration()){
 return duration===COMBAT_EFFECT_MS&&phase.some(step=>attackHitAffinity(step)!=='none')
  ?AFFINITY_EFFECT_MS:duration;
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
// RESIST/WEAK keep their full 720ms visual lifetime, but subsequent
// phases follow the normal 440ms cadence rather than waiting for the text.
export function combatPhaseAdvanceDuration(phase,duration=effectDuration()){
 return Math.min(combatPhaseDuration(phase,duration),duration);
}
// Start the death effect before the fatal attack animation ends.
// Only the final nonfatal phase can release early for a queued command.
export async function playCombatSequence(steps,paint,{
 duration=effectDuration(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
 onFatal=null,overlap=125,onLastPhase=null,onHitStop=null,hitStopMs=0
}={}){
 let death=null;
 const phases=simultaneousPhases(steps);
 for(let i=0;i<phases.length;i++){
  const phase=phases[i];
  paint(phase);
  const phaseDuration=combatPhaseAdvanceDuration(phase,duration);
  const fatal=onFatal&&!death&&i===phases.length-1?fatalSide(phase):null;
  const last=phase.at(-1);
  const canQueue=i===phases.length-1&&!fatal&&last?.hero?.hp>0&&last?.enemy?.hp>0;
  const early=canQueue?onLastPhase?.(phase,phaseDuration):null;
  if(fatal){
   const lead=Math.max(0,phaseDuration-overlap);
   // Pause the current contact frame only when an actual enemy is defeated.
   // Keep the original phase/ceremony overlap and add only the brief freeze.
   if(fatal==='enemy'&&phaseDuration>0&&hitStopMs>0&&onHitStop){
    const contact=Math.min(lead,Math.round(phaseDuration*.5));
    if(contact>0)await wait(contact);
    onHitStop(true);
    try{await wait(hitStopMs);}
    finally{onHitStop(false);}
    if(lead>contact)await wait(lead-contact);
   }else if(lead>0)await wait(lead);
   death=Promise.resolve(onFatal(fatal,phase));
   if(phaseDuration-lead>0)await wait(phaseDuration-lead);
  }else if(phaseDuration>0){
   const full=wait(phaseDuration);
   if(early)await Promise.race([full,early]);
   else await full;
  }
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
