// Keep the equipped cards and their image nodes alive while a battle advances.
export function renderBattleCards(container,layout,buildMarkup,states){
 const frames=container.querySelectorAll?.(':scope > .battle-spell-frame');
 const reusable=container.dataset.battleCardLayout===layout
  &&frames?.length===states.length
  &&states.every((state,i)=>!state||(
   frames[i].querySelector('button[data-cast]')
   &&frames[i].querySelector('.tile-cooldown')
   &&frames[i].querySelector('.battle-spell-photo')
   &&frames[i].querySelector('.circle-card-mp')
   &&frames[i].querySelector('.circle-card-power')));
 if(!reusable){
  container.innerHTML=buildMarkup();
  container.dataset.battleCardLayout=layout;
  return;
 }
 states.forEach((state,i)=>{
  if(!state)return;
  const frame=frames[i],button=frame.querySelector('button[data-cast]');
  button.disabled=state.disabled;
  button.classList.toggle('unavailable',state.disabled);
  button.classList.toggle('equipped',!state.disabled);
  button.setAttribute('aria-label',state.label);
  frame.querySelector('.tile-cooldown').textContent=state.cooldown;
  frame.querySelector('.circle-card-mp').textContent=state.mp;
  frame.querySelector('.circle-card-power').textContent=state.power;
  const photo=frame.querySelector('.battle-spell-photo'),seal=photo.querySelector('.battle-spell-seal');
  if(state.sealed&&!seal)photo.insertAdjacentHTML('beforeend','<span class="battle-spell-seal" aria-hidden="true">封</span>');
  if(!state.sealed&&seal)seal.remove();
 });
}
