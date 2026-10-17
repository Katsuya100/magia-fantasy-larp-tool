import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [page,home,css]=await Promise.all([read('dungeon.html'),read('index.html'),read('assets/css/dungeon.css')]);
assert.match(page,/自分だけの魔法陣で迷宮へ/);
assert.match(home,/自分だけの魔法陣で迷宮へ/);
assert.doesNotMatch(home,/五つの陣で深淵へ/);
assert.doesNotMatch(page,/共鳴率/);
assert.match(page,/紋様によって「⚔️攻撃・🛡️防御・✚回復・🕸️弱体」が決まります/);
assert.match(page,/解析が成功した魔法陣だけ登録します/);
assert.match(page,/MPと威力は初回使用まで伏せられます/);
assert.match(page,/assets\/images\/sample\.png/);
assert.ok((await stat(new URL('../assets/images/sample.png',import.meta.url))).size>100);
assert.match(page,/<dialog id="nameDialog"/);
assert.match(page,/id="playerNameInput"[^>]+maxlength="20"/);
assert.match(page,/id="nameForm"/);
assert.match(page,/id="collectionGrid"[^>]+role="list"/);
for(const id of ['libraryRoleFilter','libraryAttributeFilter','librarySort',
 'collectionDiscoveryFilter','collectionRarityFilter','collectionSort','pickerFilter','pickerSort']){
 assert.match(page,new RegExp('id="'+id+'"'),'native filter and sort control '+id);
}
assert.match(page,/id="tab-collection" data-view="collection"/);
assert.match(page,/id="tab-prepare" data-view="prepare" aria-current="page"[^>]*>.*?準備&amp;出発/s);
assert.match(page,/id="tab-library" data-view="library"[^>]*>.*?魔導書/s);
assert.match(page,/id="tab-dungeon" data-view="dungeon" hidden[^>]*>.*?ダンジョン/s);
assert.match(page,/id="tab-home" data-view="home"[^>]*>.*?プロフィール/s);
assert.doesNotMatch(page,/data-view="home"[^>]*>.*?冒険者<\/span>/s);
const tabMarkup=page.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
assert.ok(tabMarkup,'navigation bar exists');
const tabOrder=[...tabMarkup.matchAll(/data-view="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(tabOrder,['prepare','library','dungeon','collection','home'],'four tabs before adventure, three during');
assert.doesNotMatch(page,/data-view="library" class="subtle inner-nav"/,'grimoire must not be nested inside preparation');
assert.doesNotMatch(page,/魔導書・魔法陣登録/,'remove redundant preparation shortcut');
const tabOpenStates=[...tabMarkup.matchAll(/<button[^>]*id="tab-([^"]+)"[^>]*>/g)].map(m=>({id:m[1],hidden:/\shidden(?:\s|>)/.test(m[0])}));
assert.deepEqual(tabOpenStates,[{id:'prepare',hidden:false},{id:'library',hidden:false},{id:'dungeon',hidden:true},{id:'collection',hidden:false},{id:'home',hidden:false}]);
assert.match(page,/<section id="prepare" class="panel loadout-panel">/,'preparation visible on initial HTML');
assert.match(page,/<section id="home" class="panel adventurer-panel" hidden>/,'profile initially hidden');
assert.match(page,/<h2>準備&amp;出発<\/h2>/);
// Chapter labels follow the visible left-to-right tab order.
assert.match(page,/CHAPTER I · PREPARATION/);
assert.match(page,/CHAPTER II · GRIMOIRE/);
assert.match(page,/CHAPTER III · RELIQUARY/);
assert.match(page,/CHAPTER IV · ADVENTURER/);
const chapters=Object.fromEntries([...page.matchAll(/CHAPTER (I|II|III|IV) · ([A-Z]+)/g)].map(x=>[x[2],x[1]]));
assert.deepEqual(chapters,{ADVENTURER:'IV',GRIMOIRE:'II',PREPARATION:'I',RELIQUARY:'III'});
assert.match(page,/魔法陣の力を解明中/);


assert.match(page,/id="heroName"/,'name in duel is populated from saved profile');
assert.doesNotMatch(page,/<h3>冒険者<\/h3>/,'no generic name hard-coded inside the duel');
assert.match(page,/id="battleArena" class="arena" data-role="idle"/,'duel stage has animation state');
assert.match(page,/id="heroCombatant" class="unit hero-unit"/);
assert.match(page,/id="enemyCombatant" class="unit enemy-unit"/);
assert.match(page,/id="heroFxText"/);
assert.match(page,/id="enemyFxText"/);
assert.match(page,/id="battleCeremony"/);
assert.match(page,/id="lootChests" class="loot-chests"/);
for(const attribute of ['flame','bolt','aqua','storm','gravity','law','chaos']){
 assert.ok(css.includes('.unit[data-attribute="'+attribute+'"]'),'fighter-specific color for '+attribute);
}
for(const role of ['attack','basic','defense','debuff','support','burn','death']){
 assert.ok(css.includes('data-effect="'+role+'"'),'animation style for '+role);
}
for(const ceremony of ['encounter','hero-death','enemy-death','loot']){
 assert.ok(css.includes('data-event="'+ceremony+'"'),'ceremony CSS for '+ceremony);
}
assert.match(css,/@keyframes chest-leap/);
assert.match(css,/@keyframes chest-open/);
assert.match(css,/@keyframes loot-shower/);
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));

assert.match(css,/@keyframes fx-rush-left/);
assert.match(css,/@keyframes fx-rush-right/);
assert.match(css,/@keyframes fx-guard/);
assert.match(css,/@keyframes fx-hex/);
assert.match(css,/@keyframes fx-heal/);
assert.match(css,/@keyframes fx-burn/);
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
assert.match(page,/id="battleSpells" class="loadout-grid battle-spells"/);
assert.match(page,/id="battleItems" class="loadout-grid battle-items"/);
assert.match(page,/id="battleBasic" class="battle-basic"/);
assert.match(css,/\.battle-spells\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/,'spell layout stays five columns');
assert.match(css,/#gearCards \.loadout-grid,\.battle-items\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'item grids get three readable columns');
assert.match(css,/\.battle-spells \.battle-tile img\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.doesNotMatch(page,/鑑定/);
assert.match(page,/id="collectionProgress"/);
assert.doesNotMatch(page,/<input[^>]*type="file"/);
assert.match(page,/id="cameraStart"/);
assert.match(page,/id="cameraPane" class="capture-pane"(?! hidden)/);
assert.match(page,/<div class="camera-viewfinder"[^>]*>[\s\S]*?id="cameraPlaceholder"[\s\S]*?<video id="cameraVideo"[^>]* hidden/);
assert.match(page,/<span class="viewfinder-circle-guide" aria-hidden="true"><\/span>/,'large guide overlays the live camera');
assert.match(css,/\.camera-viewfinder \.viewfinder-circle-guide\{[^}]*inset:7%;z-index:2;pointer-events:none/,'guide has 86% diameter, never blocks taps');
assert.match(css,/viewfinder-circle-guide\{[^}]*border-radius:50%/,'guide is circular');
assert.match(css,/viewfinder-circle-guide\{[^}]*border:2px dashed/,'camera ring is dashed');
assert.doesNotMatch(page,/<canvas[^>]*>[^<]*viewfinder-circle-guide/,'guide does not paint onto captured image');
assert.match(page,/id="cameraCapture" hidden/);
assert.match(page,/id="cameraStop"[^>]* hidden/);
assert.doesNotMatch(page,/id="circleName"/);
assert.doesNotMatch(page,/id="cameraNameWrap"/);
assert.match(page,/id="openGrimoireFromPicker"/);
assert.match(page,/<div class="picker-footer">\s*<button[^>]*id="clearLoadoutSlot"[^>]*>[\s\S]*?<button[^>]*id="openGrimoireFromPicker"/,'clear action precedes grimoire link');
assert.match(css,/\.picker-footer\{[^}]*flex-direction:column/,'picker footer is vertical');
assert.doesNotMatch(page,/class="home-cta"/);
assert.match(page,/<p id="notice" hidden aria-hidden="true"><\/p>/);
assert.match(css,/\.camera-placeholder\{[^}]*display:grid/);
assert.match(css,/#slotCards \.loadout-tile,#gearCards \.loadout-tile\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.match(css,/#slotCards \.loadout-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
assert.match(css,/#gearCards \.loadout-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css,/\.camera-viewfinder\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.match(css,/#cameraVideo\{[^}]*object-fit:cover/);
assert.match(css,/\.card img\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.doesNotMatch(css,/\.card img\{height:105px\}/);
assert.match(css,/\.collection-grid\s*\{display:grid;/);
assert.match(css,/\.relic-card\.locked/);
assert.match(css,/\.name-dialog::backdrop/);
assert.match(css,/\.regulation-sample img/);
assert.match(css,/@media\(max-width:630px\)/);
assert.match(page,/🔥flame\s*\/\s*⚡️bolt\s*\/\s*💧aqua/);
assert.match(page,/🌪️storm\s*\/\s*🪨gravity\s*\/\s*⚖️law\s*\/\s*🌀chaos/);
assert.match(page,/<dialog id="loadoutDialog"/);
assert.match(page,/id="loadoutOptions" class="picker-grid"/);
assert.match(css,/\.loadout-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
assert.match(css,/\.loadout-tile\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.match(page,/<div class="portrait-seal">\s*<svg class="portrait-crest"/);
assert.doesNotMatch(page,/class="portrait-glyph"/);
assert.match(css,/\.portrait-seal\{[^}]*place-items:center/);
assert.match(css,/\.portrait-crest\{[^}]*width:58%;height:58%/);
assert.match(css,/\.portrait-bottom\{[^}]*position:static/);
assert.match(css,/@media\(max-width:630px\)[\s\S]*?\.character-portrait\{--portrait-size:112px/);
const slots=page.match(/<div id="slotCards">([\s\S]*?)<\/div><\/div>/)?.[1];
const items=page.match(/<div id="gearCards">([\s\S]*?)<\/div><\/div>/)?.[1];
assert.ok(slots&&items,'static first-view grids exist before JS starts');
assert.equal((slots.match(/data-open-slot=/g)||[]).length,5,'five spell placeholders are shipped in HTML');
assert.equal((items.match(/data-open-item=/g)||[]).length,0,'new players do not see locked item slots in initial HTML');
const currentRelease=page.match(/data-release="(\d{8}\.\d+)"/)?.[1];
assert.ok(currentRelease,'HTML exposes current public release version');
assert.ok(page.includes('dungeon.css?v='+currentRelease),'page CSS is cache-busted for current release');
assert.ok(page.includes('dungeon-app.mjs?v='+currentRelease),'page JS is cache-busted for current release');
const app=await read('assets/js/dungeon-app.mjs');
const store=await read('assets/js/dungeon-store.mjs');
const core=await read('assets/js/dungeon-core.mjs');
const picker=await read('assets/js/dungeon-preparation-ui.mjs');
for(const specifier of app.matchAll(/from ['"]\.\/([^'"]+\.mjs)(\?[^'"]*)?['"]/g)){
 assert.equal(specifier[2],specifier[1]==='dungeon-tuning.mjs'?undefined:'?v='+currentRelease,'stale entry module '+specifier[1]);
}
assert.match(core,/from '\.\/dungeon-tuning\.mjs'/);
assert.match(store,/from '\.\/dungeon-core\.mjs'/);
assert.match(picker,/from '\.\/dungeon-loadout\.mjs'/);
assert.doesNotMatch(app,/魔法陣を保存した。性能は初回使用時に判明する。/);
assert.doesNotMatch(app,/鑑定/);
assert.doesNotMatch(picker,/鑑定/);
assert.match(app,/battleImageUrl\(c\.image\)/);
assert.match(app,/Math\.max\(5,run\.carry\.length\)/);
assert.match(app,/\$\('heroName'\)\.textContent=profile\.name/);
assert.match(app,/step=>steps\.push\(step\)/,'game engine steps are captured for sequential playback');
assert.match(app,/await animateBattle\(steps\)/);
assert.ok(app.includes('await playCombatSequence(steps,phase=>'));
assert.ok(app.includes('for(const step of phase)'),'both fighters are painted within one phase');
assert.ok(app.includes("treasureChestMarkup(drops)"),'drop count controls number of chests');
assert.ok(app.includes("rewards.length+'個 · 未確定',rewards.length"));
assert.ok(app.includes("await ceremony('encounter'"),'battle begins with an encounter');
assert.ok(app.includes("onFatal:side=>ceremony(side==='hero'?'hero-death':'enemy-death'"),'fatal ceremony overlaps the last attack');
assert.match(app,/const step=\(role,amount\)=>/,'consumable effect animation');


assert.ok(app.includes('circles=newestCirclesFirst([...circles,analyzed])'),'successful captures sort newest first');
assert.ok(app.includes('await putCircle(db,analyzed)'),'save only after successful camera analysis');
assert.match(app,/await analyzeCapturedCircle\(circle\)/,'camera opens analysis before registering');
assert.match(app,/const analyzed=savePreanalysis\(circle,result\);[\s\S]*?await putCircle\(db,analyzed\)/,'save follows validation');
assert.doesNotMatch(app,/circleTitle|魔法陣 '\+String/);
assert.match(app,/newestCirclesFirst\(await allCircles\(db\)\)/);
assert.match(app,/newCapturedCircle\(crypto\.randomUUID\(\),blob,lastCaptureRegistration\)/);
assert.doesNotMatch(picker,/displayName|c\.name/);
assert.match(app,/openGrimoireFromPicker/);
assert.match(app,/\$\('tab-prepare'\)\.hidden=exploring/);
assert.match(app,/\$\('tab-library'\)\.hidden=exploring/);
assert.match(app,/\$\('tab-dungeon'\)\.hidden=!exploring/);
assert.match(app,/syncCameraUi\(true\)/);
assert.match(app,/syncCameraUi\(false\)/);
assert.doesNotMatch(app,/\$\('circleName'\)/);
assert.doesNotMatch(picker,/escapeText\(c\.name\)/);
assert.match(page,/id="magicDetailsDialog"/,'touch-to-enlarge magic detail dialog');
assert.match(page,/id="circleActionDialog"/,'delete and enhancement need confirmation');
assert.match(page,/id="upgradeCircle"/,'magic-circle detail can be upgraded');
assert.match(page,/id="startAttack"[^>]*>迷宮へ潜る<\/button>/,'departure button has no arrow');
assert.doesNotMatch(page,/迷宮へ潜る\s*<span[^>]*>⟶<\/span>/,'remove arrow glyph');
assert.match(css,/#magicDetailsStats dd,#upgradeHint,#upgradeFeedback,#circleActionMessage\{\s*white-space:pre-line/,'magic-circle and upgrade texts honor newlines');
assert.match(app,/oneSentencePerLine\(value\)/,'magic-circle effect descriptions split by sentence');
assert.match(app,/circleUpgrades:\{\.\.\.\(profile\.circleUpgrades\|\|\{\}\)/,'upgrade metadata stored with profile');
assert.match(page,/id="magicStoneBalance"/,'magic stone count appears in the grimoire');
assert.match(page,/<p id="magicStoneBalance"[^>]*>✦ 魔導石：0個<\/p>/,'initial magic-stone count is concise');
assert.doesNotMatch(page,/魔法陣の強化に使用/,'no redundant magic-stone explanation in static HTML');
assert.match(app,/magicStoneBalance'\)\.textContent='✦ 魔導石：'\+profile\.magicStones\+'個'/,'all player balances render only the item count');
assert.doesNotMatch(app,/個（魔法陣の強化に使用）/,'no redundant explanation in dynamic JS');
for(const [rarity,mark] of [['common','○ コモン'],['uncommon','◇ アンコモン'],
 ['rare','◆ レア'],['epic','✦ エピック'],['legendary','★ レジェンダリー']]){
 assert.ok(app.includes(rarity+":'"+mark+"'"),rarity+' retains its legible rarity text');
 assert.match(css,new RegExp('\\.relic-card\\.discovered\\[data-rarity="'+rarity+'"\\]\\{[\\s\\S]*?--rarity-ink:#[0-9a-f]{6};--rarity-glow:#[0-9a-f]{8}'),rarity+' has a distinct solid hue and visible glow');
}
assert.match(app,/\+\(found\?'<span class="relic-rarity">'/,'rarity names are only shown for discovered collectibles');
assert.ok(app.includes(`data-rarity="'+(found?rarity:'unknown')`),'unfound relics still hide their rarity');
assert.equal(css.includes('/* Color-vision accessibility:'),false,'previous flat, no-glow frame redesign must be removed');
assert.match(css,/\.relic-card\.discovered \.relic-art\{[\s\S]*?box-shadow:0 0 0 9px var\(--rarity-halo\),[\s\S]*?0 0 32px var\(--rarity-glow\)/,'original luminous halo and bloom are restored');
assert.match(css,/\.relic-card\.discovered \.relic-glyph\{[\s\S]*?text-shadow:0 0 20px var\(--rarity-glow\)/,'glyph keeps colorful glow');
assert.doesNotMatch(css.slice(css.indexOf('/* Restore the collection')),/border-style\s*:|border-width\s*:|border:\s*\d+px/,'new rarity treatment does not modify frame patterns or widths');
assert.match(css,/\.relic-card\{[^}]*border:1px solid var\(--border\)/,'the original outer card frame is unchanged');
assert.match(css,/\.relic-art\{[^}]*border:1px solid #e1c58b77/,'the original circular frame thickness stays unchanged');
assert.match(css,/\.relic-card\.discovered \.relic-rarity\{[\s\S]*?font-size:14px/,'rarity labels remain readable');
assert.match(page,/<h2>プロフィール<\/h2>/,'profile heading matches the tab');
assert.match(css,/@keyframes circle-upgrade-aura/,'upgrades have a ritual animation');
assert.match(page,/id="deleteSaveData"[^>]*data-action="delete-data"/,'profile has a full save deletion action');
assert.match(page,/id="deleteDataDialog"/,'data reset is confirmed');
assert.match(page,/id="deleteDataPhrase"/,'data reset requires typing a confirmation word');
assert.match(app,/clearDungeonData\(db\)/,'save reset clears both persistent stores');
assert.match(app,/applyView\(name,before\)/,'tabs crossfade while preserving the outgoing scene');
assert.match(css,/@keyframes snappy-rush-hero/,'hero attacks have accelerated easing');
assert.match(css,/@keyframes snappy-rush-enemy/,'enemy attacks have accelerated easing');
assert.match(css,/@keyframes snappy-screen-shake/,'attacks shake the arena');
assert.match(css,/@keyframes encounter-slide/,'encounter banner fades in, pauses and fades out');
const encounterKeyframes=css.match(/@keyframes encounter-slide\{([\s\S]*?)\n\}/)?.[1];
assert.ok(encounterKeyframes&&!encounterKeyframes.includes('transform:'),'full-width encounter overlay cannot translate or scale the viewport');
const lootKeyframes=css.match(/@keyframes loot-ceremony-arrive\{([\s\S]*?)\n\}/)?.[1];
assert.ok(lootKeyframes&&!lootKeyframes.includes('transform:'),'loot overlay does not zoom before next encounter');
assert.match(css,/@keyframes encounter-title-slide/,'only encounter text slides');
assert.doesNotMatch(css,/@keyframes enemy-snap-entrance/,'old scaled enemy entrance is removed');
assert.doesNotMatch(css,/@keyframes enemy-entrance/,'original scaled enemy entrance is removed');
assert.match(css,/html,body\{overflow-x:clip\}/,'mobile viewport width remains clipped during animated overlays');
assert.match(css,/#battleArena\{overflow-x:clip;min-width:0;max-width:100%\}/,'enemy slides cannot expand the arena');
assert.match(app,/scrollIntoView\?\.\(\{behavior:'instant',block:'start'\}\)/,'starting exploration cannot animate scrolling during the enemy entrance');
assert.match(css,/@keyframes sanctuary-gentle-arrival/,'return shrine eases and fades in slowly');

assert.match(css,/#battleArena\[data-shake="true"\] \.versus/,'attack camera jolt stays inside the arena');
assert.doesNotMatch(css,/#battle\.battle-panel\[data-shake="true"\]/,'whole battle panel must never shake');
assert.match(app,/\$\('battleArena'\)\.dataset\.shake/,'combat shake JS only targets arena');
assert.doesNotMatch(app,/\$\('battle'\)\.dataset\.shake/,'battle scene is never transformed by attack shake');
assert.match(app,/const terminalSwap=\['checkpoint','result'\]\.includes\(name\)/,'short end scenes do not crossfade against the tall battle panel');
assert.match(css,/@keyframes terminal-fade-in\{from\{opacity:0\}to\{opacity:1\}\}/,'end screens fade opacity only');
const deathOverlayFrames=css.match(/@keyframes ceremony-arrive\{([^\n]+)\}/)?.[1]||'';
assert.ok(deathOverlayFrames&&!deathOverlayFrames.includes('transform:'),'fatal overlay must not shrink or enlarge during transition');
assert.match(css,/\.scene-stack > #checkpoint\.panel:not\(\[hidden\]\)/,'checkpoint transition does not overlap the old battle');
assert.match(css,/\.scene-stack > #result\.panel:not\(\[hidden\]\)/,'defeat and return transition does not overlap the old battle');
const battleMarkup=page.match(/<section id="battle"[^>]*>([\s\S]*?)<\/section>/)?.[1]||'';
assert.ok(battleMarkup.indexOf('id="battleInfo"')>battleMarkup.indexOf('id="battleArena"')&&
 battleMarkup.indexOf('id="battleInfo"')<battleMarkup.indexOf('<h3>魔法陣</h3>'),'pending loot, XP and item usage appear above the magic-circle heading');
assert.equal((battleMarkup.match(/id="battleInfo"/g)||[]).length,1,'combat status is displayed only once');
for(const side of ['hero','enemy']){
 const fighter=battleMarkup.match(new RegExp('<article id="'+side+'Combatant"[\\s\\S]*?<\\/article>'))?.[0]||'';
 assert.match(fighter,/class="element-flare"/,side+' elemental flare present');
 assert.match(fighter,/class="element-trail"/,side+' elemental trail present');
}
for(const attr of ['flame','bolt','aqua','storm','gravity','law','chaos']){
 assert.match(css,new RegExp('data-attribute="'+attr+'"\\] \\.element-flare'),attr+' has its own attack animation shape');
}
for(const name of ['element-flame-rise','element-wave-crash','element-bolt-strike','element-vortex','element-gravity-crush','element-law-seal','element-chaos-burst','element-shield-raise','element-hex-bind','element-healing-cross']){
 assert.match(css,new RegExp('@keyframes '+name+'\\{'),name+' animation has its own keyframes');
}
for(const role of ['attack','defense','support']){
 assert.match(css,new RegExp('data-effect="'+role+'"\\] \\.element-flare|data-effect="'+role+'"\\]\\[data-attribute="flame"\\] \\.element-flare'),role+' effect is visually differentiated');
}
assert.match(css,/data-incoming="debuff"\] \.element-flare/,'debuff curses appear on their target');
assert.match(css,/clip-path:polygon\(50% 0,95% 17%/,'defense effect uses recognizable shield silhouette');
assert.match(css,/clip-path:polygon\(37% 0,63% 0,63% 36%/,'support effect uses recognizable healing cross');
assert.match(app,/victim\.dataset\.incoming=step\.role/,'the opponent receives the debuff effect');
assert.match(app,/target\.dataset\.incoming='none'/,'incoming effects are cleared between turns');

assert.match(page,/id="dungeonScenes" class="scene-stack"/,'scene panels share a fixed origin');
assert.match(css,/\.scene-stack > \.panel\[data-exiting="true"\]/,'outgoing panel fades over incoming panel');
assert.match(css,/\.scene-stack > \.panel\[data-entering="true"\]/,'incoming panel fades in');
assert.doesNotMatch(css, /::view-transition-old\(root\)/,'never zoom a full-screen snapshot');
assert.match(css,/#battleArena \.unit\{\s*box-sizing:border-box;height:280px/,'fighters do not stretch with status effects');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{/,'fighter stats share consistent fixed rows');
assert.match(css,/@keyframes enemy-snap-slide/,'enemy only slides, never shrinks');
assert.match(css,/@keyframes loot-ceremony-arrive/,'loot animation restarts without an empty death frame');
assert.match(app,/if\(event!=='enemy-death'\)\{/,'death overlay remains during handoff');
assert.doesNotMatch(app,/document\.startViewTransition/,'no root View Transition flicker');
assert.match(css,/dialog\[open\]\{opacity:1/,'dialogs fade in and out');
assert.doesNotMatch(page,/id="captureAnalyzerFrame"/,'photo analysis must not run in a hidden iframe');
assert.match(page,/id="analyzerFrame" title="マギアサークル解析"/,'capture analysis uses visible screen');
assert.match(app,/show\('analyzing'\)/,'captures visibly transition to analysis');
assert.match(app,/await analyzeCapturedCircle\(circle\)/,'camera waits until analysis settles');
assert.match(page,/3〜5 SIGILS/);
assert.match(page,/id="circleCounter"/);
assert.match(app,/canDepartWithCircles\(slots\)/,'three to five spell loadout');
assert.match(app,/revealOnUse\(circle\)/,'power reveals on actual cast');
const knowledge=await read('assets/js/dungeon-magic-knowledge.mjs');
const fx=await read('assets/js/dungeon-combat-fx.mjs');
for(const [key,label] of [['attack','⚔️攻撃'],['defense','🛡️防御'],['support','✚回復'],['debuff','🕸️弱体']]){
 assert.ok(knowledge.includes(key+":'"+label+"'"),'role icon displayed for '+key);
 assert.ok(fx.includes(key+":'"+label+"'"),'combat effect uses icon for '+key);
}
assert.doesNotMatch(page,/id="attributeEffects"/,'remove global attribute effect legend');
assert.doesNotMatch(page,/7属性の強化・🕸️弱体効果/,'effect names belong to their individual circles');
assert.match(app,/circleEffectBadges\(c,masters\.buffs,esc,G\.mpCost\)/);
assert.match(app,/circleEffectDetails\(circle,masters\.buffs\)/);
assert.match(app,/\['追加効果の詳細',info\.statusDescription\]/);
assert.match(css,/\.circle-card-info\{[^}]*display:flex/);
assert.match(css,/\.circle-card-stats\{[^}]*font-size:/);
const thumbnails=await read('assets/js/dungeon-preparation-ui.mjs');
assert.match(thumbnails,/class="circle-card-symbols"/);
assert.match(thumbnails,/class="circle-card-status"/);
assert.match(thumbnails,/class="circle-card-mp">MP:/);
assert.match(thumbnails,/class="circle-card-power">威力:/);
assert.match(css,/\.circle-grid \.card-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'grimoire detail and delete side-by-side');
assert.match(css,/\.circle-card-mp,\.circle-card-power\{[^}]*white-space:nowrap/,'stats stay on their own lines');
assert.match(app,/createCircleImageUrls\(\)/,'photo URLs persist through repeated turns');
assert.doesNotMatch(app,/releaseBattleUrls\(\)|freeUrls\(\)/,'no premature object URL revocation');
assert.match(app,/if\(!id\)return '<div class="battle-spell-frame"/,'empty slots render without a cast button');
assert.doesNotMatch(thumbnails,/効果を大きく見る|効果を拡大/);
assert.match(css,/\.magic-details-stats\{[^}]*font-size:/);
assert.match(page,/迷宮へ潜る/);
assert.doesNotMatch(page,/迷宮へ入る|持ち込みアイテム/);
assert.match(app,/携行品上限：/);
assert.doesNotMatch(app,/持ち込み上限|次回の持ち込み上限/);
assert.match(css,/#checkpointInfo,#resultText\{[^}]*white-space:pre-line/,'story text displays one line per sentence');
assert.match(app,/narrativeLines\('checkpointInfo'/);
assert.match(app,/narrativeLines\('resultText'/);
assert.match(app,/battleHeading\(run.floor\)/,'encounter heading reflects layer and battle');
assert.match(app,/deepestReturnedLayer\(profile\)/,'profile records successful returns only');
assert.match(app,/dataset\.defeated='true'/,'defeated enemy stays invisible');
assert.match(css,/#battleArena \.enemy-unit\[data-defeated="true"\]\{visibility:hidden/);

assert.doesNotMatch(page,/魔法陣は3〜5個で出発できます。空き枠はそのままでOK。/,'unnecessary equipment help is removed');
assert.match(page,/class="spell-flight" aria-hidden="true"/,'projectiles stay in a decorative arena overlay');
for(const side of ['hero','enemy']){
 assert.match(page,new RegExp('id="'+side+'Projectile"[^>]*data-side="'+side+'"'),'both casters have independent projectile layers');
}
assert.match(app,/if\(step\.role==='attack'\)\{[\s\S]*?projectile\.dataset\.attribute=[\s\S]*?projectile\.dataset\.effect='attack'/,'only magic attacks launch attribute-matched projectiles');
assert.match(app,/\$\(side\+'Projectile'\)\.dataset\.effect='idle'/,'projectile animation resets after combat phases');
assert.match(css,/#battleArena \.spell-projectile\[data-side="hero"\]/,'hero projectile starts on right');
assert.match(css,/#battleArena \.spell-projectile\[data-effect="attack"\]/,'attack projectiles trigger flight animation');
const flightFrames=css.match(/@keyframes spell-projectile-flight\{([\s\S]*?)\n\}/)?.[1]||'';
assert.match(flightFrames,/left:var\(--flight-from\)/,'magic launches from the attacker');
assert.match(flightFrames,/left:var\(--flight-to\)/,'magic travels to the opponent');
assert.match(css,/#battleArena \.spell-flight\{[\s\S]*?overflow:hidden;pointer-events:none/,'visual effects are clipped to the arena');
for(const attr of ['flame','bolt','aqua','storm','gravity','law','chaos']){
 for(const layer of ['element-flare','element-trail']){
  assert.ok(css.includes('spell-projectile[data-effect="attack"][data-attribute="'+attr+'"] .'+layer),
   attr+' projectile preserves the distinct '+layer+' visuals');
  assert.ok(!css.includes('.unit[data-effect="attack"][data-attribute="'+attr+'"] .'+layer),
   attr+' effect is no longer fixed to the caster card');
 }
}
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*#battleArena \.spell-projectile/,'reduced motion disables flight');
for(const selector of ['.hero-edition,.eyebrow,.chapter,.subheading>span',
 '.stat-cell small','.relic-detail,.relic-name','.list-controls label']){
 assert.ok(css.includes(selector),'readability overrides for '+selector);
}
assert.match(css,/\.tabs button\{font-size:14px;min-height:68px/,'mobile navigation labels are readable');
assert.match(css,/\.circle-card-mp,\.circle-card-power\{white-space:normal/,'narrow spell stats can wrap instead of shrinking');

/* Regression: a 5-column cast button must not stretch to fill effect-summary
   rows. Both combatant boxes and the HP/MP starts remain fixed and aligned. */
assert.match(css,/\.battle-spells\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/,'five spell columns are unchanged');
assert.match(css,/\.battle-spells\{align-items:start\}/,'spell frames start aligned without stretching');
assert.match(css,/\.battle-spell-frame \.battle-tile\{\s*flex:0 0 auto;height:auto;min-height:0/,'cast button sizes to its own image and 発動 label');
assert.match(css,/\.battle-spells \.tile-cooldown\{\s*margin-top:4px/,'cast label stays just below the image');
assert.match(css,/#battleArena \.unit\{\s*height:280px;min-height:280px;max-height:280px/,'both combatants have fixed identical desktop height');
assert.match(css,/#battleArena \.unit\{\s*height:240px;min-height:240px;max-height:240px/,'both combatants have fixed identical mobile height');
assert.match(css,/#battleArena \.unit-info\{\s*width:100%;min-width:0;min-height:0;flex:1;\s*display:grid;grid-template-rows:38px minmax\(0,1fr\)/,'both names reserve the exact same fixed row height');
assert.match(css,/#battleArena \.unit-info h3\{[\s\S]*?white-space:normal;overflow-wrap:anywhere;[\s\S]*?-webkit-line-clamp:2/,'long names wrap over two lines instead of escaping the card');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*width:100%;min-width:0;min-height:0;display:grid;\s*grid-template-rows:38px 38px 35px minmax\(0,1fr\)/,'both sides align HP, MP and MAG/DEF/RES rows');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*min-width:0;min-height:0;flex:1;overflow:visible/,'status area stops scrolling');
assert.doesNotMatch(css,/#battleArena #enemyStats,#battleArena #heroStats\{[^}]*overflow-y:auto/,'no hidden per-combatant stats scrollbars');
assert.match(css,/#battleArena \.combat-attributes\{\s*min-width:0;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'MAG, DEF and RES are in separate columns');
assert.match(app,/function rowUnit\(unit\)\{[\s\S]*?class="battle-vital"[\s\S]*?class="combat-attributes"[\s\S]*?class="combat-attribute"/,'fighter HP/MP and attributes use non-wrapping, compact markup');
console.log('PASS camera circle guide, layer progression, 3-column items, readable story, terminology and fantasy layout');
