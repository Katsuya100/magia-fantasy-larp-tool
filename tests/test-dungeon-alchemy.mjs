import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alchemyRecipe,alchemyAutoSelect,craftAlchemy,alchemyByproductRates,alchemyMilestones} from '../assets/js/dungeon-alchemy.mjs';
import {alchemyItemGrid,itemGrid} from '../assets/js/dungeon-preparation-ui.mjs';

const csv=readFileSync(new URL('../assets/data/dungeon-consumables.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
const keys=csv.shift().split(',');
const rows=csv.map(line=>Object.fromEntries(line.split(',').map((cell,i)=>[keys[i],cell])));
const buffs=[{id:'buff_aqua',kind:'buff'},{id:'buff_bolt',kind:'buff'}];
const make=(id,value=0,n=0)=>({id,value,instanceId:'item-'+n});
const recipe=(rarity,items)=>alchemyRecipe({id:'relic',rarity},items,rows);
const five=(id,value=10)=>Array.from({length:5},(_,i)=>make(id,value,i));

// Summed value, strongest grade, and both HP / MP variants.
assert.deepEqual(recipe('common',five('heal_s',20)),{id:'heal_s',value:100});
assert.deepEqual(recipe('common',[...five('heal_s',20).slice(0,4),make('heal_l',100)]),{id:'heal_l',value:180});
assert.deepEqual(recipe('common',five('mana_m',33)),{id:'mana_m',value:165});
assert.deepEqual(recipe('common',[make('heal_s',30),make('heal_s',20),make('mana_m',40),make('mana_s',10),make('clear_flame')]),{id:'heal_s',value:110});
assert.deepEqual(recipe('common',[make('heal_s',30),make('mana_s',10),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'mana_s',value:70});
assert.deepEqual(recipe('common',[make('heal_s',10),make('heal_m',20),make('clear_flame'),make('clear_aqua'),make('clear_bolt')]),{id:'heal_m',value:60});
assert.deepEqual(recipe('common',[make('elixir_s',35),make('heal_s',20),make('mana_s',20),make('clear_flame'),make('clear_bolt')]),{id:'elixir_s',value:35});
assert.deepEqual(recipe('common',five('clear_flame')),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('common',[make('heal_s',40),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('epic',[make('elixir_s',35),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('common',[make('escape_scroll'),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:2});
assert.deepEqual(recipe('common',[make('life_ruby',2),make('life_ruby',4),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'life_ruby',value:14});

// Only epic or legendary can unlock combination recipes.
const mixed=[make('heal_l',100),make('mana_xl',120),make('clear_flame'),make('clear_bolt'),make('clear_aqua')];
assert.deepEqual(recipe('epic',mixed),{id:'elixir_l',value:100});
assert.equal(recipe('rare',mixed).id,'mana_xl');
const statuses=['flame','bolt','aqua','storm','gravity'].map(name=>make('clear_'+name));
assert.deepEqual(recipe('legendary',statuses),{id:'luna_stone',value:0});
assert.deepEqual(recipe('common',statuses),{id:'escape_scroll',value:0});
const life=[make('elixir_s',35),make('luna_stone'),make('escape_scroll'),make('heal_s',40),make('clear_flame')];
assert.deepEqual(recipe('epic',life),{id:'life_ruby',value:0});
assert.equal(recipe('rare',life).id,'escape_scroll');

// Auto-select keeps distinct original indexes and honors type and priority.
const inventory=[make('clear_flame',0,0),make('heal_s',2,1),make('heal_l',500,2),make('mana_m',60,3),make('heal_m',90,4),make('mana_s',10,5)];
assert.deepEqual(alchemyAutoSelect(inventory,rows,'hp','value'),[2,4,1]);
assert.deepEqual(alchemyAutoSelect(inventory,rows,'mp','value-asc'),[5,3]);
assert.deepEqual(alchemyAutoSelect(inventory,rows,'status'),[0]);
assert.deepEqual(alchemyAutoSelect(inventory,rows,'hp'),[1,4,2],
 'unspecified auto-select priority defaults to lowest effect first');
const abundant=[make('heal_s',25,0),make('mana_s',40,1),make('heal_s',30,2),
 make('clear_flame',0,3),make('heal_s',12,4),make('mana_s',50,5)];
assert.deepEqual(alchemyAutoSelect(abundant,rows,'all','count'),[0,2,4,1,5],
 'more of the same item ID wins regardless of effect value; tied quantities preserve acquisition order');
assert.deepEqual(alchemyAutoSelect(abundant,rows,'mp','count'),[1,5],
 'count-based auto-selection works together with category filtering');
assert.deepEqual(alchemyAutoSelect(abundant,rows,'all','default'),[0,1,2,3,4],
 'existing acquisition-order priority is unchanged');

// Crafting is immutable, consumes exactly one relic and five instances,
// removes equipped ingredients by instance ID, and keeps other slots intact.
const profile={collection:{relic:2},inventory:[...five('heal_s',20),make('mana_l',65,5)],
 carrySlots:['item-0','item-5','item-3',null,null],obtainedItemIds:['heal_s']};
const common={id:'relic',rarity:'common'};
const crafted=craftAlchemy(profile,common,[0,1,2,3,4],rows,buffs,()=>.9,()=>'new-item');
assert.equal(crafted.collection.relic,1);
assert.equal(crafted.inventory.length,2);
assert.equal(crafted.inventory[0].instanceId,'item-5');
assert.deepEqual(crafted.inventory[1],{id:'heal_s',value:100,instanceId:'new-item'});
assert.deepEqual(crafted.carrySlots,[null,'item-5',null,null,null]);
assert.equal(profile.collection.relic,2);
assert.equal(profile.inventory.length,6);
assert.deepEqual(profile.carrySlots,['item-0','item-5','item-3',null,null]);
assert.throws(()=>craftAlchemy(profile,common,[0,0,1,2,3],rows),/5個/);
assert.throws(()=>craftAlchemy({...profile,collection:{relic:1}},common,[0,1,2,3,4],rows),/不足/);
assert.throws(()=>craftAlchemy({...profile,run:{}},common,[0,1,2,3,4],rows),/探索中/);
assert.throws(()=>recipe('common',five('heal_s').slice(0,4)),/5個/);

// Rarity bonuses: common none; uncommon/rare chance; epic/legendary guaranteed.
const bonusProfile={...profile,inventory:five('heal_s',20)};
const outcome=(rarity,values)=>{
 const sequence=values[Symbol.iterator]();
 return craftAlchemy(bonusProfile,{id:'relic',rarity},[0,1,2,3,4],rows,buffs,()=>sequence.next().value??.99,()=>'crafted').inventory[0];
};
assert.equal(outcome('common',[0]).alchemyBoost,undefined);
assert.deepEqual([outcome('uncommon',[.25]).value,outcome('uncommon',[.6]).value],[125,100]);
assert.equal(outcome('epic',[.99]).value,125);
assert.equal(outcome('rare',[.4,.9]).bonus,'buff_bolt');
assert.equal(outcome('rare',[.8]).bonus,undefined);
assert.equal(outcome('legendary',[.99,.01]).bonus,'buff_aqua');

// Byproducts always accompany an ordinary crafted item, never consume inventory slots.
// Common relics cannot yield ink. Strong ingredients boost odds, but the caps hold.
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);
const standard=five('heal_s',20),powerful=five('heal_xl',1000);
close(alchemyByproductRates(common,standard).stone,.12);
assert.equal(alchemyByproductRates(common,powerful).ink,0);
assert.deepEqual(alchemyByproductRates({rarity:'legendary'},powerful),{stone:1,ink:.23});
close(alchemyByproductRates({rarity:'uncommon'},powerful).stone,.30);
close(alchemyByproductRates({rarity:'rare'},powerful).ink,.08);
assert.deepEqual(alchemyMilestones({}),{count:0,stoneIn:5,inkIn:20});
assert.deepEqual(alchemyMilestones({alchemyCount:4}),{count:4,stoneIn:1,inkIn:16});
assert.deepEqual(alchemyMilestones({alchemyCount:20}),{count:20,stoneIn:5,inkIn:20});

const source={...bonusProfile,alchemyCount:4,magicStones:7,magicInk:2};
const award=(saved,relic,randomValues)=>{
 const sequence=randomValues[Symbol.iterator]();
 return craftAlchemy(saved,relic,[0,1,2,3,4],rows,buffs,()=>sequence.next().value??.99,()=>'byproduct-item');
};
const fifth=award(source,common,[.99,.99,.99]);
assert.equal(fifth.alchemyCount,5);
assert.equal(fifth.magicStones,8,'fifth craft grants one guaranteed stone despite missed random roll');
assert.equal(fifth.magicInk,2,'fifth craft does not grant ink');
assert.equal(fifth.inventory.length,1,'byproducts are currencies, not inventory items');
assert.equal(source.alchemyCount,4,'count updates immutably');
assert.equal(source.magicStones,7,'stone count updates immutably');

const twentieth=award({...source,alchemyCount:19},common,[.99,.99,.99]);
assert.equal(twentieth.alchemyCount,20);
assert.equal(twentieth.magicStones,8,'twentieth craft is also a stone milestone');
assert.equal(twentieth.magicInk,3,'twentieth craft awards ink even with common relic');
const legendaryReward=award({...source,alchemyCount:19},{...common,rarity:'legendary'},[.99,.99,.99,.99]);
assert.equal(legendaryReward.magicStones,9,'guaranteed legendary stone stacks with fifth milestone');
assert.equal(legendaryReward.magicInk,3,'twentieth milestone ink is independent of rarity roll');

const randomDrop=award({...source,alchemyCount:0},{...common,rarity:'rare'},[.9,.11,.02]);
assert.equal(randomDrop.magicStones,8,'rare stone roll succeeds');
assert.equal(randomDrop.magicInk,3,'rare ink roll succeeds independently');
const failedDrop=award({...source,alchemyCount:0},common,[.9,.99,0]);
assert.equal(failedDrop.magicStones,7,'failed common stone roll grants nothing');
assert.equal(failedDrop.magicInk,2,'common relic never drops ink, even with zero random');
const legacy=award({...source,alchemyCount:undefined,magicStones:undefined,magicInk:undefined},common,[.99,.99,.99]);
assert.equal(legacy.alchemyCount,1,'older save has no alchemy progress');
assert.equal(legacy.magicStones,0);
assert.equal(legacy.magicInk,0);

// Alchemy mechanics stay intact, while hidden outcomes are revealed only after crafting.
const page=readFileSync(new URL('../dungeon.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
assert.doesNotMatch(page,/id="alchemy(?:Preview|Result|ByproductChance|MilestoneProgress)"/);
assert.doesNotMatch(page,/副産物の確率|魔導石確定まで|魔導墨確定まで|副産物なし/);
assert.doesNotMatch(app,/\$\('alchemy(?:Preview|Result|ByproductChance|MilestoneProgress)'\)/);
assert.doesNotMatch(app,/錬金成功：|副産物なし/);
assert.doesNotMatch(page+app,/所持品の順(?:番)?/,'all item-order labels use acquisition order');
assert.match(page,/<option value="default">入手順<\/option>/);
assert.match(page,/id="alchemyAutoPriority"[^>]*>[\s\S]*?<option value="count">数が多い順<\/option>/);
assert.match(page,/<select id="alchemyAutoPriority"><option value="value-asc" selected>効果量が低い順<\/option>/,
 'new alchemy dialogs default to low-effect ingredients');
assert.match(page,/id="alchemyPickerSort"[^>]*>[\s\S]*?<option value="count">数が多い順<\/option>/);
assert.match(app,/\['count','数が多い順'\]/,'alchemy picker has count sorting option');
assert.match(app,/\['default','入手順'\]/);
assert.match(page,/id="alchemyReveal"[^>]*hidden/);
assert.match(page,/id="alchemyCreatedIcon"/);
assert.match(page,/id="alchemyRevealDone"/);
assert.match(app,/\$\('alchemyInputs'\)\.hidden=true;\s*\$\('alchemyReveal'\)\.hidden=false;/);
assert.match(app,/await saveProfile\(db,next\);[\s\S]*?\$\('alchemyCreatedIcon'\)\.textContent=itemSymbol\(item\)/);
// Only alchemy splits the selectable icon square from its name/effect panel.
const visible=alchemyItemGrid([0,1,2,null,4],five('heal_s',25),item=>item.id,x=>x);
assert.equal((visible.match(/class="alchemy-item-frame"/g)||[]).length,5);
assert.equal((visible.match(/data-open-alchemy-item=/g)||[]).length,5);
assert.equal((visible.match(/class="alchemy-item-info"/g)||[]).length,4);
assert.equal((visible.match(/class="alchemy-item-effect"/g)||[]).length,4);
assert.equal((visible.match(/❤️\+25/g)||[]).length,4);
assert.match(visible,/data-open-alchemy-item="3"[^>]*>[^<]*<span class="tile-index">04<\/span><span class="tile-item-icon" aria-hidden="true">＋<\/span><\/button>/);
assert.doesNotMatch(visible,/class="tile-title"/,'names are below, not inside, icon squares');
assert.doesNotMatch(itemGrid([0],five('heal_s',25),1,true,item=>item.id,x=>x),/alchemy-item-frame/,'other loadouts use their existing layout');
assert.match(app,/alchemyItemGrid\(choices,profile\.inventory,itemName,esc\)/);
assert.match(css,/#alchemySlots \.alchemy-item-frame\{[^}]*flex-direction:column/);
assert.match(css,/#alchemySlots \.alchemy-item-frame \.loadout-tile\{[^}]*aspect-ratio:1 \/ 1/);
assert.match(css,/#alchemySlots \.alchemy-item-info\{[^}]*min-height:54px/);
assert.match(css,/#alchemySlots \.alchemy-item-name\{[^}]*white-space:normal/,'long item names wrap without clipping');
assert.match(css,/#alchemySlots \.alchemy-item-name\{[^}]*overflow-wrap:anywhere/,'long names fit narrow mobile slots');
assert.match(css,/#alchemySlots \.alchemy-item-info\{[^}]*grid-template-rows:minmax\(min-content,1fr\) auto/,'effects align below variable-height names');
assert.match(css,/#alchemySlots \.alchemy-item-effect\{[^}]*white-space:nowrap/);
// The base collection icon is the same SVG and .relic-art sizing as the collection grid.
assert.match(page,/id="alchemyBaseRelic"[^>]*class="alchemy-base-relic relic-card discovered"/);
assert.match(page,/id="alchemyBaseIcon" class="relic-art"/);
assert.match(app,/\$\('alchemyBaseIcon'\)\.innerHTML=relicSymbolSvg\(relicIndex,true\)/);
assert.match(css,/\.alchemy-base-relic \.relic-art\{margin:5px auto 10px\}/);
// Every part of the craft reveal, including bonus stone/ink rewards, must settle
// within 500ms.  Visual reward symbols remain conditional on actual drops.
const animationSelectors=['alchemy-ring','alchemy-ring-outer','alchemy-flash',
 'alchemy-created-icon','alchemy-created-name','alchemy-created-effect','alchemy-rewards','alchemy-reward'];
for(const selector of animationSelectors){
 const styles=css.match(new RegExp('\\.'+selector+'\\{([^}]+)\\}'))?.[1]||'';
 const animation=styles.match(/animation:([^;}]+)/)?.[1]||'';
 assert.ok(animation,'animation is defined for '+selector);
 const seconds=[...animation.matchAll(/(?:^|\s)(\d*\.?\d+)s(?=\s|$)/g)].map(match=>Number(match[1]));
 assert.ok(seconds.length>=1,'animation duration is explicit for '+selector);
 assert.ok(seconds.reduce((sum,value)=>sum+value,0)<=.5+1e-9,
  selector+' duration including delay is within 500ms');
}
assert.match(css,/\.alchemy-ring-inner\{[^}]*animation-delay:\.04s/);
assert.match(css,/\.alchemy-rewards\{[^}]*animation:alchemy-materialize \.3s \.2s/,
 'bonus rewards now appear at the end of the half-second animation');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{[^}]*\.alchemy-reward\{animation:none\}/);
assert.match(app,/addedStones\?'<span class="alchemy-reward"[^']+魔導石/);
assert.match(app,/addedInk\?'<span class="alchemy-reward"[^']+魔導墨/);
assert.match(app,/\]\.join\(''\);[\s\S]*?\$\('alchemyInputs'\)\.hidden=true/);
assert.match(css,/@keyframes alchemy-materialize/);
assert.match(css,/prefers-reduced-motion:reduce[^\n]*\.alchemy-ring/);

console.log('PASS dungeon alchemy: recipes, rarity, slots, byproduct odds and milestones');
