import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {craftAlchemy} from '../assets/js/dungeon-alchemy.mjs';
import {itemBonusEffect,itemHasEffectiveAlchemyBoost,itemEffectIcons,itemEffectText} from '../assets/js/dungeon-preparation-ui.mjs';
import {statusBadges} from '../assets/js/dungeon-status-ui.mjs';
import {circleEffectDetails} from '../assets/js/dungeon-magic-knowledge.mjs';
import {pendingRankBadgeNames} from '../assets/js/dungeon-ranks.mjs';

const csv=readFileSync(new URL('../assets/data/dungeon-consumables.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
const columns=csv.shift().split(',');
const itemRows=csv.map(line=>Object.fromEntries(line.split(',').map((cell,i)=>[columns[i],cell])));
const ingredients=ids=>ids.map((id,i)=>({id,instanceId:'item-'+i,value:id.startsWith('elixir_')?35:10}));
const craft=(rarity,ids,random=()=>0)=>craftAlchemy({
 collection:{relic:2},inventory:ingredients(ids),carrySlots:[],obtainedItemIds:[]
},{id:'relic',rarity},[0,1,2,3,4],itemRows,
 [{id:'buff_flame',kind:'buff',effect:'attack'}],random,()=>'created').inventory[0];

const stone=craft('legendary',['clear_flame','clear_bolt','clear_aqua','clear_storm','clear_gravity']);
assert.equal(stone.id,'luna_stone');
assert.equal(stone.alchemyBoost,undefined,'a cleanser cannot gain recovery potency');
const scroll=craft('legendary',['escape_scroll','heal_s','mana_s','clear_flame','clear_bolt']);
assert.equal(scroll.id,'escape_scroll');
assert.equal(scroll.bonus,undefined,'an escape scroll cannot apply bonus buffs');
assert.equal(scroll.alchemyBoost,undefined,'an escape scroll cannot gain recovery potency');
const oldScroll={id:'escape_scroll',value:0,alchemyBoost:true,bonus:'buff_flame'};
assert.equal(itemHasEffectiveAlchemyBoost(oldScroll),false,'legacy no-op potency must stay hidden');
assert.equal(itemBonusEffect(oldScroll),null,'legacy no-op bonus must stay hidden');
assert.equal(itemEffectIcons(oldScroll),'↩️');
assert.doesNotMatch(itemEffectText(oldScroll),/追加効果|効果量アップ/);
const ruby=craft('epic',['elixir_s','luna_stone','escape_scroll','heal_s','clear_flame']);
assert.equal(ruby.id,'life_ruby');
assert.equal(ruby.alchemyBoost,undefined,'revival chance and HP remain fixed');
const potion=craft('epic',['heal_s','heal_s','heal_s','heal_s','heal_s']);
assert.equal(potion.value,63);
assert.equal(potion.alchemyBoost,true,'actual HP healing gains are labeled');
assert.equal(itemHasEffectiveAlchemyBoost(potion),true);
const capped=craft('epic',['elixir_l','heal_s','mana_s','clear_flame','clear_bolt']);
assert.equal(capped.id,'elixir_l');
assert.equal(capped.value,100);
assert.equal(capped.alchemyBoost,undefined,'already-full recovery must not show fake growth');

for(const [attribute,icon] of Object.entries({flame:'🔥↑',bolt:'⚡↑',aqua:'💧↑',storm:'🌪️↑',gravity:'🪨↑',law:'🕸️🛡️↑',chaos:'🌀↑'})){
 const item={id:'heal_s',bonus:'buff_'+attribute,value:20};
 assert.equal(itemBonusEffect(item).icons,icon,'item bonus glyph: '+attribute);
 const rendered=statusBadges([{id:'buff_'+attribute,attribute,turns:2,kind:'buff'}]);
 assert.ok(rendered.includes(icon.replace('↑','')),'combat status glyph: '+attribute);
}
assert.equal(itemBonusEffect({id:'heal_s',bonus:'resist_flame'}).icons,'🛡️🔥↑');
assert.ok(itemEffectIcons({id:'clear_law',value:0}).includes('⚖️'));

const chaos={analysis:{role:'defense',attribute:'chaos',power:700},revealed:true};
assert.match(circleEffectDetails(chaos).statusDescription,/六属性/);
assert.doesNotMatch(circleEffectDetails(chaos).statusDescription,/七属性/);
const law={analysis:{role:'defense',attribute:'law',power:700},revealed:true};
assert.match(circleEffectDetails(law).statusDescription,/秩序属性への耐性と弱体効果への耐性/);

assert.deepEqual(pendingRankBadgeNames([{type:'rank',layer:10},{type:'rank',layer:20},{type:'stone'}]),['鉛級冒険者章','鉄級冒険者章']);
assert.deepEqual(pendingRankBadgeNames([{type:'rank',layer:10}]),['鉛級冒険者章']);
assert.deepEqual(pendingRankBadgeNames([]),[]);
assert.deepEqual(pendingRankBadgeNames([{type:'rank',layer:10}],20),[],'a prior boss badge must not repeat');
assert.deepEqual(pendingRankBadgeNames([{type:'rank',layer:10}],null),[],'no new badge means no notice');
assert.deepEqual(pendingRankBadgeNames([{type:'rank',layer:10}],10),['鉛級冒険者章']);

const html=readFileSync(new URL('../dungeon.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const share=readFileSync(new URL('../assets/js/dungeon-share.mjs',import.meta.url),'utf8');
const guide=html.split('<dialog id="iconGuideDialog"')[1].split('</dialog>')[0];
for(const sentence of ['10層ごとのボス撃破時にHP・MP各80%以上','序盤20戦中18戦','最終ボスを3ターン以内','上位ボス撃破で一つ下の等級','帰還時に確定']){
 assert.ok(guide.includes(sentence),'the in-game guide explains: '+sentence);
}
assert.match(guide,/🕸️🛡️↑/);
assert.match(app,/pendingRankBadgeNames\(run\.loot,run\.checkpointBadgeLayer===undefined\?layer:run\.checkpointBadgeLayer\)/,'checkpoint shows only the newly awarded tier');
assert.match(app,/帰還済み踏破層/);
assert.match(share,/帰還済み踏破層/);
assert.match(readFileSync(new URL('../assets/data/dungeon-consumables.csv',import.meta.url),'utf8'),/clear_chaos,暴走の浄化薬/);
console.log('PASS display errata: alchemy, icons, magic details, badges, depth and cleanser');
