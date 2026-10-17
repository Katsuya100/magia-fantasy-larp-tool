// Visual playback follows the ordered snapshots emitted by dungeon-core.round.
// Animations never alter combat math or determine turn outcomes.
export const EFFECT_LABELS={attack:'攻撃',basic:'通常攻撃',defense:'防御',debuff:'弱体',support:'回復',buff:'強化',burn:'火傷',item:'道具'};
export const ELEMENT_GLYPHS={flame:'🔥',bolt:'⚡',aqua:'💧',storm:'🌪',gravity:'⬤',law:'⚖',chaos:'☄'};
export function effectCaption(step){
 const tag=EFFECT_LABELS[step.role]||'術式';
 const symbol=ELEMENT_GLYPHS[step.attribute]||'✦';
 const n=Number(step.amount)||0;
 if(step.role==='attack'||step.role==='basic'||step.role==='burn')return symbol+' '+tag+' −'+n;
 if(step.role==='support'||step.role==='item')return symbol+' '+tag+(n?' +'+n:'');
 return symbol+' '+tag;
}
export function effectDuration(){
 // Keep reduced-motion users and headless test environments from waiting for animations.
 if(typeof window==='undefined'||typeof window.matchMedia!=='function')return 0;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:780;
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
export async function playCombatSequence(steps,paint,{duration=effectDuration(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(const phase of simultaneousPhases(steps)){
  paint(phase);
  if(duration>0)await wait(duration);
 }
}
export async function playBattleCeremony(event,paint,{duration=effectDuration(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 paint(event);
 if(duration>0)await wait(duration);
}
