import assert from 'node:assert/strict';
import {renderBattleCards} from '../assets/js/dungeon-battle-cards.mjs';

function tile(){
 const flags=new Set(['equipped']);
 const button={disabled:false,attributes:{},classList:{
  toggle(name,enabled){if(enabled)flags.add(name);else flags.delete(name);},
  contains(name){return flags.has(name);}
 },setAttribute(name,value){this.attributes[name]=value;}};
 const cooldown={textContent:'発動'},mp={textContent:'MP:?'},power={textContent:'威力:?'};
 const image={src:'blob:stable',isConnected:true};
 let seal=null;
 const photo={
  image,
  querySelector(selector){return selector==='.battle-spell-seal'?seal:null;},
  insertAdjacentHTML(position,html){
   assert.equal(position,'beforeend');
   assert.match(html,/battle-spell-seal/);
   seal={remove(){seal=null;}};
  }
 };
 const parts={'button[data-cast]':button,'.tile-cooldown':cooldown,'.circle-card-mp':mp,
  '.circle-card-power':power,'.battle-spell-photo':photo};
 return {button,cooldown,mp,power,photo,querySelector(selector){return parts[selector]||null;}};
}
const cards=[tile(),null,tile(),null,null];
let writes=0,html='';
const container={dataset:{},
 get innerHTML(){return html;},
 set innerHTML(value){writes++;html=value;},
 querySelectorAll(){return cards.map(card=>card||{querySelector(){return null;}});}
};
const ready={disabled:false,sealed:false,label:'魔法陣 1',cooldown:'発動',mp:'MP:?',power:'威力:?'};
const states=[ready,null,ready,null,null];
renderBattleCards(container,'a|empty|b|empty|empty',()=>'<div>initial</div>',states);
assert.equal(writes,1,'first render creates the layout');
const image=cards[0].photo.image;
const changed={disabled:true,sealed:true,label:'魔法陣 1 封印',cooldown:'待機 2',mp:'MP:9',power:'威力:5000'};
renderBattleCards(container,'a|empty|b|empty|empty',()=>{throw Error('existing DOM must not be recreated');},
 [changed,null,ready,null,null]);
assert.equal(writes,1,'next turn must reuse the full card subtree');
assert.equal(cards[0].photo.image,image,'the original image node survives');
assert.equal(image.src,'blob:stable','the image source remains intact');
assert.equal(cards[0].button.disabled,true,'MP/cooldown/seal can disable casting');
assert.equal(cards[0].button.classList.contains('unavailable'),true);
assert.equal(cards[0].button.classList.contains('equipped'),false);
assert.equal(cards[0].button.attributes['aria-label'],'魔法陣 1 封印');
assert.equal(cards[0].cooldown.textContent,'待機 2');
assert.equal(cards[0].mp.textContent,'MP:9','first-use reveal updates numbers without replacing the card');
assert.equal(cards[0].power.textContent,'威力:5000');
assert.ok(cards[0].photo.querySelector('.battle-spell-seal'),'seal mark appears in the existing photo frame');

renderBattleCards(container,'a|empty|b|empty|empty',()=>{throw Error('same layout');},
 [{...changed,disabled:false,sealed:false,cooldown:'発動'},null,ready,null,null]);
assert.equal(cards[0].button.disabled,false,'casting becomes enabled when restrictions clear');
assert.equal(cards[0].button.classList.contains('equipped'),true);
assert.equal(cards[0].photo.querySelector('.battle-spell-seal'),null,'seal mark clears');
assert.equal(writes,1,'unsealing does not replace any card');

renderBattleCards(container,'different loadout',()=>'<div>new loadout</div>',states);
assert.equal(writes,2,'genuine loadout changes may rebuild the card grid');
console.log('PASS battle cards retain their photo DOM while cooldown, castability, seal and reveal update');
