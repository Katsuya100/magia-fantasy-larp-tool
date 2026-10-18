import assert from 'node:assert/strict';
import {circleEffectBadges,spellGrid,circleChoices} from '../assets/js/dungeon-preparation-ui.mjs';
import {circleCardInfo,circleEffectDetails} from '../assets/js/dungeon-magic-knowledge.mjs';
const buffs=[
 {id:'buff_flame',name:'炎熱鼓舞',duration:2,effect:'attack'},
 {id:'debuff_flame',name:'火傷',duration:2,effect:'burn'},
 {id:'buff_chaos',name:'混沌の祝福',duration:2,effect:'output'},
 {id:'debuff_chaos',name:'混乱',duration:2,effect:'confused'}
];
const shot=(role,attribute='flame',revealed=false)=>({
 id:role+'-'+attribute,image:new Blob(['x']),analysis:{attribute,role,power:512},revealed
});
const escapeText=t=>String(t);
const mpCost=()=>6;
const defense=shot('defense'),debuff=shot('debuff'),attack=shot('attack'),support=shot('support'),chaos=shot('debuff','chaos');
for(const [circle,symbols,effect] of [
 [defense,'🔥 / 🛡️','炎熱鼓舞'],[debuff,'🔥 / 🕸️','火傷'],
 [attack,'🔥 / ⚔️',null],[support,'🔥 / ✚',null],
 [chaos,'🌀 / 🕸️','ランダム弱体']
]){
 const html=circleEffectBadges(circle,buffs,escapeText,mpCost);
 assert.ok(html.includes('class="circle-card-symbols">'+symbols+'</span>'),'paired icons on thumbnail');
 assert.equal((html.match(/class="circle-card-status"/g)||[]).length,effect?1:0,'only actual buff/debuff names appear');
 if(effect)assert.ok(html.includes('>'+effect+'</span>'));
 assert.match(html,/<span class="circle-card-mp">MP:\?<\/span><span class="circle-card-power">威力:\?<\/span>/,'unknown MP and power always use separate rows');
 assert.doesNotMatch(html,/512|MP:6|属性攻撃|属性防御|属性弱体/,'no extra effect heading or secret numbers');
}
const activated=circleEffectBadges({...defense,revealed:true},buffs,escapeText,mpCost);
assert.match(activated,/<span class="circle-card-mp">MP:6<\/span><span class="circle-card-power">威力:512<\/span>/);
assert.equal(circleCardInfo(debuff,buffs,mpCost).statusName,'火傷');
assert.match(circleEffectDetails(debuff,buffs).statusDescription,/継続ダメージ/);
assert.match(circleEffectDetails(defense,buffs).statusDescription,/攻撃ダメージ/);
assert.match(circleEffectDetails(defense,buffs).duration,/2ターン/);
assert.equal(circleEffectDetails(attack,buffs).statusName,'');
assert.equal(circleEffectDetails(support,buffs).statusName,'');
const roster=[defense,debuff,attack,support,chaos],ids=roster.map(c=>c.id);
const grid=spellGrid(ids,roster,()=>'/img.png',escapeText,true,buffs,mpCost);
assert.equal((grid.match(/class="circle-card-info"/g)||[]).length,5,'each spell carries its own details');
assert.equal((grid.match(/class="circle-card-status"/g)||[]).length,3,'only defense/debuff have named status effects');
assert.equal((grid.match(/class="circle-card-mp">MP:\?<\/span><span class="circle-card-power">威力:\?<\/span>/g)||[]).length,5);
assert.equal((grid.match(/class="loadout-tile equipped"/g)||[]).length,5,'preserve five original equipment tiles');
const picker=circleChoices(roster,ids,()=>'/img.png',escapeText,null,buffs,mpCost);
assert.equal((picker.match(/class="circle-card-info"/g)||[]).length,0,'picker hides stats to give the image more space');
assert.equal((picker.match(/data-circle-detail=/g)||[]).length,5,'the full effect details remain accessible for every circle');
assert.equal((picker.match(/class="picker-option/g)||[]).length,5,'five distinct square choices remain selectable');
assert.doesNotMatch(picker,/class="picker-label"/,'no duplicate summary row');
console.log('PASS spell thumbnails: role and attribute icons, only actual statuses, MP/power unknown until used');
