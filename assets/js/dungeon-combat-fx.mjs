// Visual playback follows the ordered snapshots emitted by dungeon-core.round.
// Animations never alter combat math or determine turn outcomes.
export const EFFECT_LABELS={attack:'⚔️攻撃',basic:'⚔️通常攻撃',defense:'🛡️防御',debuff:'🕸️弱体',support:'✚回復',buff:'強化',burn:'火傷',item:'道具'};
export const ELEMENT_GLYPHS={flame:'🔥',bolt:'⚡',aqua:'💧',storm:'🌪',gravity:'⬤',law:'⚖',chaos:'☄'};
export function effectCaption(step){
 const tag=EFFECT_LABELS[step.role]||'術式';
 const symbol=ELEMENT_GLYPHS[step.attribute]||'✦';
 const n=Number(step.amount)||0;
 if(step.role==='attack'||step.role==='basic'||step.role==='burn')return symbol+' '+tag+' −'+n;
 if(step.role==='support'||step.role==='item')return symbol+' '+tag+(n?' +'+n:'');
 return symbol+' '+tag;
}
export const COMBAT_EFFECT_MS=440;
export const ENCOUNTER_EFFECT_MS=820;
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
