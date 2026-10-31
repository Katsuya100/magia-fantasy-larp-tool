import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [page,home,css]=await Promise.all([read('dungeon.html'),read('index.html'),read('assets/css/dungeon.css')]);
assert.match(page, /<html lang="ja" style="touch-action: manipulation">/, 'double-tap zoom disabled only on dungeon page');
assert.match(page, /<meta name="viewport" content="width=device-width,initial-scale=1">/, 'pinch zoom remains enabled');
assert.match(page,/自分だけの魔法陣で迷宮へ/);
assert.match(page,/<a class="back-link" href="index.html">〈 アーカイブへ戻る<\/a>/,'archive link remains in the header');
assert.match(css,/#dungeonApp\[data-exploring="true"\] \.hero\{min-height:0;padding:/,'active exploration removes the tall hero minimum height');
assert.match(css,/#dungeonApp\[data-exploring="true"\] \.hero-inner\{min-height:0/,'active exploration removes the inner hero minimum height');
assert.match(css,/#dungeonApp\[data-exploring="true"\] \.hero h1 span\{display:inline/,'compact expedition title is inline');
assert.match(page,/<button type="button" id="returnHome" class="danger">帰還する<\/button>/,'short return button');
assert.match(css,/#returnHome\{background:linear-gradient\(#d9494f,#941f32\)/,'return button is red');
assert.doesNotMatch(page,/FREE ACTION · 1 \/ ROUND|道具使用回数|携行品使用状況/,'obsolete labels absent');
assert.match(home,/自分だけの魔法陣で迷宮へ/);
assert.doesNotMatch(home,/五つの陣で深淵へ/);
assert.doesNotMatch(page,/共鳴率/);
assert.doesNotMatch(page,/魔法陣の描き方・登録規則|class="regulations"/,'old rule panel removed');
assert.equal((page.match(/class="subtle circle-power-tips-button"/g)||[]).length,2,'both entry points have tips');
const tipDialog=page.split('id="circlePowerTipsDialog"')[1].split('</dialog>')[0];
for(const phrase of ['線やカーブを綺麗に','読みやすく','円の線に重ねない','重複しない英単語'])
 assert.match(tipDialog,new RegExp('<strong>'+phrase+'</strong>'),'important parts bold');
assert.match(tipDialog,/assets\/images\/sample\.png/,'sample is the ideal drawing');
assert.match(tipDialog,/<figure><figcaption>理想的な例<\/figcaption><img/,'ideal example is labeled before the image');
assert.match(css,/#circleDrawingDialog \.circle-power-tips-button\{position:absolute;top:max\(10px,env\(safe-area-inset-top\)\);left:max\(10px,env\(safe-area-inset-left\)\)/,'drawing tips are aligned to the existing header buttons');
assert.match(css,/\n\.circle-power-tips-button\{\s*min-height:34px/,'camera tips use normal flow while drawing positioning stays scoped');
assert.match(css,/\.circle-camera-dialog \.camera-viewfinder-toolbar\{display:flex;justify-content:space-between/,'camera actions share a toolbar above the viewfinder');
assert.match(css,/#tutorialAttributes\{[^}]*white-space:pre-line;word-break:keep-all/,'element list retains intentional line breaks');
assert.match(css,/\.circle-power-tips-dialog strong\{color:#ff737b;font-weight:800/,'tips are bold red');
assert.doesNotMatch(page,/dungeon-circle-tutorial\.gif/);
assert.match(page,/assets\/images\/sample\.png/);
assert.ok((await stat(new URL('../assets/images/sample.png',import.meta.url))).size>100);
assert.match(page,/<dialog id="nameDialog"/);
assert.match(page,/<div id="startupMask" class="startup-mask" role="dialog" aria-modal="true" aria-busy="true"/,'startup loading dialog is present before any JS runs');
assert.match(page,/<main id="dungeonApp" class="shell"[^>]*aria-busy="true" inert>/,'game is inert until the startup dialog is dismissed');
assert.match(page,/<div class="startup-bar" role="progressbar"/,'startup includes an accessible activity indicator');
assert.match(page,/<a id="startupRetry"[^>]*hidden>/,'startup error offers an explicit retry');
assert.match(css,/\.startup-mask\{[^}]*position:fixed;inset:0;z-index:9999/,'startup mask covers the page');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.startup-bar span\{animation:none/,'startup animation respects reduced-motion preference');
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
assert.match(page,/<h2 id="floorLabel"><\/h2><p id="battleEncounterLabel" class="battle-encounter-label"><\/p>/,
 'battle heading separates layer name and smaller encounter line');
assert.match(css,/\.battle-encounter-label\{[^}]*font-size:clamp\(13px,1\.8vw,16px\)/,
 'encounter count uses smaller typography than layer heading');
// Chapter labels follow the visible left-to-right tab order.
assert.match(page,/CHAPTER I · PREPARATION/);
assert.match(page,/CHAPTER II · GRIMOIRE/);
assert.match(page,/CHAPTER III · RELIQUARY/);
assert.match(page,/CHAPTER IV · ADVENTURER/);
const chapters=Object.fromEntries([...page.matchAll(/CHAPTER (I|II|III|IV) · ([A-Z]+)/g)].map(x=>[x[2],x[1]]));
assert.deepEqual(chapters,{ADVENTURER:'IV',GRIMOIRE:'II',PREPARATION:'I',RELIQUARY:'III'});
assert.match(page,/魔法陣の力を解明中/);


assert.match(page,/id="heroName"/,'name in duel is populated from saved profile');
assert.match(page,/<div class="combatant-heading"><h3 id="enemyName"><\/h3><span id="enemyLevel" class="combatant-level"><\/span><\/div>/,'enemy name and level have separate lines');
assert.match(page,/<div class="combatant-heading"><h3 id="heroName"><\/h3><span id="heroLevel" class="combatant-level"><\/span><\/div>/,'hero name and level have separate lines');
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
assert.equal((page.match(/<input[^>]*type="file"/g)||[]).length,0,'camera retakes never offer file selection');
assert.match(page,/<video id="imageRepairVideo" autoplay muted playsinline hidden>/,'retakes use a live camera feed');
assert.match(page,/id="imageRepairCapture" hidden>撮影して保存<\/button>/,'retakes save a fresh camera shot');
assert.match(page,/id="openCircleCamera"/);
assert.match(page,/id="circleCameraDialog" class="circle-drawing-dialog circle-camera-dialog"/);
const cameraDialog=page.split('id="circleCameraDialog"')[1].split('</dialog>')[0];
assert.ok(cameraDialog.indexOf('id="cameraPane"')<cameraDialog.indexOf('id="tutorialReplay"'),'practice belongs to the camera pane');
assert.ok(cameraDialog.indexOf('class="camera-viewfinder-group"')<cameraDialog.indexOf('id="tutorialReplay"'),'practice snaps to the viewfinder wrapper');
assert.ok(cameraDialog.indexOf('id="tutorialReplay"')<cameraDialog.indexOf('class="camera-viewfinder"'),'practice sits immediately above the camera');
assert.ok(cameraDialog.indexOf('class="camera-viewfinder-toolbar"')<cameraDialog.indexOf('id="circleCameraPowerTips"'),'camera tips are in the same toolbar as practice');
assert.ok(cameraDialog.indexOf('id="circleCameraPowerTips"')<cameraDialog.indexOf('id="tutorialReplay"'),'camera tips on the left, practice on the right');
assert.ok(cameraDialog.indexOf('id="tutorialReplay"')<cameraDialog.indexOf('class="camera-viewfinder"'),'camera toolbar is outside and above the photo frame');
const drawingDialog=page.split('id="circleDrawingDialog"')[1].split('</dialog>')[0];
assert.ok(drawingDialog.indexOf('id="circleDrawingPowerTips"')<drawingDialog.indexOf('id="circleDrawingPractice"'),'drawing tips are first in the existing header');
assert.ok(drawingDialog.indexOf('id="circleDrawingPractice"')<drawingDialog.indexOf('class="circle-drawing-display"'),'both drawing actions are outside the preview');
assert.match(css,/\.circle-camera-dialog \.camera-viewfinder-toolbar\{display:flex;justify-content:space-between/,'practice and tips share a left-right row');
assert.match(css,/\.circle-camera-dialog \.camera-viewfinder-group\{[^}]*gap:5px/,'practice is close to the viewfinder');
assert.match(css,/@media\(max-width:630px\)\{\.circle-camera-dialog \.camera-viewfinder-group\{width:min/,'practice stays snapped to the camera on mobile');
assert.match(page,/id="cameraPane" class="capture-pane"(?! hidden)/);
assert.match(page,/<div class="camera-viewfinder"[^>]*>[\s\S]*?id="cameraPlaceholder"[\s\S]*?<video id="cameraVideo"[^>]* hidden/);
assert.match(page,/<span class="viewfinder-circle-guide" aria-hidden="true"><\/span>/,'large guide overlays the live camera');
assert.match(css,/:root\{--circle-guide-inset:7%\}/,'guide remains 86% diameter');
assert.match(css,/\.camera-viewfinder \.viewfinder-circle-guide\{[^}]*inset:var\(--circle-guide-inset\);z-index:2;pointer-events:none/,'guide never blocks taps and shares the crop inset');
assert.match(css,/viewfinder-circle-guide\{[^}]*border-radius:50%/,'guide is circular');
assert.match(css,/viewfinder-circle-guide\{[^}]*border:2px dashed/,'camera ring is dashed');
assert.doesNotMatch(page,/<canvas[^>]*>[^<]*viewfinder-circle-guide/,'guide does not paint onto captured image');
assert.match(page,/id="cameraCapture"[^>]*disabled>撮影📷/);
assert.match(page,/id="cameraStop"[^>]*>閉じる/);
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
assert.match(css,/#cameraVideo,#imageRepairVideo\{[^}]*object-fit:cover/,'both camera previews cover the viewfinder');
assert.match(css,/\.card img\{[^}]*aspect-ratio:1\s*\/\s*1/);
assert.doesNotMatch(css,/\.card img\{height:105px\}/);
assert.match(css,/\.collection-grid\s*\{display:grid;/);
assert.match(css,/\.relic-card\.locked/);
assert.match(css,/\.name-dialog::backdrop/);
assert.match(css,/\.circle-power-tips-dialog img/,'example image uses the shared tips popup');
assert.match(css,/@media\(max-width:630px\)/);
assert.match(page,/<option value="flame">🔥flame<\/option><option value="bolt">⚡bolt<\/option><option value="aqua">💧aqua/,'element labels are English in grimoire filters');
assert.match(page,/<option value="storm">🌪️storm<\/option><option value="gravity">🪨gravity<\/option><option value="law">⚖️law<\/option><option value="chaos">🌀chaos/,'all seven labels are English');
assert.match(page,/<dialog id="loadoutDialog"/);
assert.match(page,/id="loadoutOptions" class="picker-grid"/);
assert.match(css,/\.picker-grid\.circle-picker-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'circle picker has exactly three columns');
assert.match(css,/\.circle-picker-grid \.picker-circle-wrap\{[^}]*display:flex;flex-direction:column;gap:5px/,'circle picker cards are tall, vertically stacked');
assert.doesNotMatch(css,/\.circle-picker-grid \.picker-circle-wrap\{[^}]*aspect-ratio:1\s*\/\s*1/,'circle picker cards no longer have a forced square ratio');
assert.match(css,/\.circle-picker-grid \.picker-circle-wrap \.picker-option\{[^}]*aspect-ratio:1\s*\/\s*1/,'only the photo button remains square');
assert.match(css,/\.circle-picker-grid \.picker-circle-wrap \.picker-option img\{[^}]*width:100%;height:100%/,'circle image fills the photo button');
assert.match(css,/\.circle-picker-grid \.picker-circle-wrap \.magic-expand\{[^}]*position:static;width:100%/,'details button follows the statistics rather than covering the photo');
assert.doesNotMatch(page,/id="startLayerHint"|10層ごとの冒険者章を獲得すると開始階層が増えます。/,'misleading start layer hint is removed from static HTML');
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
assert.match(css,/\.return-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'return collection and rewards have exactly three columns');
assert.match(css,/\.return-grid\{[^}]*max-height:min\(40dvh,320px\)/,'return list scrolls internally to keep the action in view');
assert.match(css,/@media\(max-width:630px\)\{\.return-panel[^}]+\}\.return-glyph[^}]+\}\.return-panel h2[^}]+\}\.return-grid\{[^}]*repeat\(3,minmax\(0,1fr\)\)/,'mobile maintains three columns');
assert.match(css,/\.return-treasure \.return-new,\.return-reward \.return-new\{/,'first-acquisition badges have a distinct style');
assert.ok(page.includes('v'+currentRelease.slice(0,4)+'.'+currentRelease.slice(4,6)+'.'+currentRelease.slice(6,8)+'.'+currentRelease.slice(9)),'visible version confirms the refreshed public release');
assert.match(page,/<div id="battleInfo" class="battle-info" role="group" aria-label="探索中の経験値・戦利品"/,'battle counters use a dedicated accessible grouped status');
assert.match(page,/<div id="checkpointLedger" class="battle-info" role="group" aria-label="帰還の祭壇の経験値・戦利品"/,'sanctuary reuses the same reward card class');
const rewardSource=await read('assets/js/dungeon-app.mjs');
assert.match(page,/id="magicInkDialog"/,'ink selection has a dedicated dialog');
assert.match(page,/魔導墨を使うと威力の高い魔法陣を作成できます。/,'dialog explains bonus');
assert.doesNotMatch(page,/id="useMagicInk"|id="magicInkBalance"|魔導のインク/,'old grimoire checkbox and copy removed');

assert.match(rewardSource,/\$\('magicInkStock'\)\.textContent='所持：'\+profile\.magicInk\+'個'/,'stock shown only in dialog');
assert.doesNotMatch(page,/ボスから20%でドロップ|基礎威力＋10%/,'no unsolicited ink explanation in HTML');
assert.match(rewardSource,/function rewardLedgerMarkup\(run\)/,'battle and sanctuary share a reward renderer');
const rewardLedger=rewardSource.slice(rewardSource.indexOf('function rewardLedgerMarkup(run)'),rewardSource.indexOf('\nfunction updateDungeonPanelBackground'));
assert.ok(rewardLedger.indexOf('data-kind="xp"')<rewardLedger.indexOf('data-kind="loot"'),'EXP is the first (left) card, loot is the second (right) card');
assert.match(rewardLedger,/data-kind="xp"[\s\S]*?獲得EXP[\s\S]*?run\.xp/,'left card retains the true EXP amount');
assert.match(rewardLedger,/data-kind="loot"[\s\S]*?戦利品[\s\S]*?run\.loot\.length/,'right card retains the true loot count');
assert.match(rewardSource,/\$\('battleInfo'\)\.innerHTML=rewardLedgerMarkup\(run\)/,'battle reuses the ordered ledger');
assert.match(rewardSource,/\$\('checkpointLedger'\)\.innerHTML=rewardLedgerMarkup\(run\)/,'checkpoint refreshes the card contents');
assert.doesNotMatch(rewardSource,/未確定 · 持ち帰り待ち/,'no redundant labels');
assert.doesNotMatch(rewardSource,/\x27未確定報酬 \x27\+run\.loot\.length/,'checkpoint has no duplicate reward line');
assert.match(css,/\.battle-info\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'battle ledger presents two equal-width cards');
assert.match(css,/@media\(max-width:630px\)\{\s*\.battle-info\{gap:5px/,'battle counters remain compact on phones');


assert.match(css,/#gearCards \.loadout-tile,#battleItems \.battle-item-tile\{[^}]*aspect-ratio:1\s*\/\s*1/,'prepared and battle item tiles are both square');
assert.match(css,/#gearCards \.tile-item-effect,#battleItems \.tile-item-effect\{[^}]*position:static/,'item effects sit directly beneath item names, never pinned at the bottom');
assert.match(css,/#gearCards \.loadout-tile,#battleItems \.battle-item-tile\{[^}]*justify-content:center/,'both contexts center their icon/name/effect group');
assert.doesNotMatch(css,/#gearCards \.tile-item-effect\{[^}]*position:absolute/,'no obsolete absolute positioning of prepared item stats');
assert.match(page,/<select id="collectionSort"><option value="common">レア度が低い順<\/option>/,'ascending rarity is the first and default collection option');
assert.doesNotMatch(page,/<option value="default">レアリティ順<\/option>/,'redundant rarity-order option is removed');
assert.match(page,/<option value="1">1層から<\/option>/,'first layer label is concise');
assert.match(css,/\.picker-option\.picker-selected\{\s*border:1px solid #f2cf81!important;/,'selected choice border does not change the button box size');
const app=await read('assets/js/dungeon-app.mjs');
assert.doesNotMatch(app,/startLayerHint|10層ごとの冒険者章を獲得すると開始階層が増えます。/,'hint must not reappear after JS starts');
assert.match(app,/className=picker\.kind==='circle'\?'picker-grid circle-picker-grid':'item-picker-list'/,'item picker uses the shared accordion layout');
assert.match(app,/item:\{filter:'all',sort:'kind',previousSort:'default'\}/,'kind is the default only for item picker');
assert.match(app,/picker\.kind==='item'&&value!=='kind'\)view\.previousSort=value/,'preparation picker remembers last sorting when kind is reselected');
assert.doesNotMatch(css,/\.item-picker-options \.picker-option\{/, 'original item button spacing and alignment must not be overridden');
assert.doesNotMatch(css,/\.item-picker-options \.picker-label small\{/, 'original item effect text style must not be overridden');
assert.match(app,/run\.checkpointBattleScrollY=window\.scrollY/,'boss victory captures the battle scroll before showing checkpoint');
assert.match(app,/restoreContinuedBattleScroll\(previousScroll\)/,'continuing deeper restores the original battle scroll');
assert.match(app,/if\(terminalSwap&&before!==name&&\(before==='battle'/,'other return transitions retain their previous navigation behavior');
assert.match(app,/shuffledLayerEnemyIds\(masters\.enemies,layer,Math\.random,slot\)/,'game assigns and saves a random order for each new layer');
assert.match(app,/run\.layerEnemyOrder=\{layer,ids:/,'the order is stored in the active expedition');
assert.match(app,/finishStartup\(\);\s*if\(profile\.run\?\.stage==='checkpoint'&&profile\.run\.creatorCongratulationsPending\)showCreatorCongratulations\(\);\s*if\(profile\.awaitingHeir\)openNameDialog\(true\);\s*else if\(!profile\.name\)openBackupSetup\(\)/,'successors resume naming immediately; new players see backup setup first');
assert.match(page,/<dialog id="backupSetupDialog"/,'backup setup dialog exists');

const copyWarning='バックアップがない端末内セーブは予告なく消える可能性があります。';
const concurrentWarning='複数ブラウザで同時プレイをすると進行が巻き戻る場合があります';
assert.equal(page.split(copyWarning).length-1,2,'unbacked save loss is declared in setup and the disconnected profile section');
assert.match(page,/id="backupRiskWarning" class="backup-sync-warning"/,'profile risk notice can disappear after confirmed backup');
assert.match(page,/id="backupRollbackWarning" class="backup-sync-warning" hidden/,'concurrent-browser warning only appears once connected');
assert.doesNotMatch(page,/id="setupCreatePlayer"|id="setupSwitchGoogleDrive"/,'no redundant no-backup chooser appears');
assert.match(page,/<dialog id="googleDriveConflictDialog" class="name-dialog"/,'one player chooser handles case 3, case 5, and timestamp ties');
assert.match(page,/data-action="restore"><\/button>/,'Drive player button is named from the actual backup');
assert.match(page,/data-action="overwrite"><\/button>/,'local or new player button is named dynamically');
assert.match(page,/data-action="later">キャンセル<\/button>/,'different players can cancel without changing either save');
assert.match(page,/data-action="cancel" aria-label="キャンセル"/,'X is available when cancellation is allowed');
assert.doesNotMatch(page,/id="googleDriveOverwriteDialog"|id="googleDriveOverwriteWarning"/,'obsolete double-confirmation UI is gone');
assert.match(css,/#googleDriveConflictDialog \[data-action="overwrite"\]\{background:linear-gradient\(#d9494f,#941f32\)/,'original red overwrite button styling is preserved');
const cloudSyncSource=await read('assets/js/dungeon-cloud-sync.mjs');
assert.doesNotMatch(cloudSyncSource,/meta\?\.blocked|meta\?\.freshStart|同期エラー：Drive上にバックアップがありません/,'obsolete sync state gates are removed');
assert.match(cloudSyncSource,/await establishLegacyIntegrity\(db,local\);\s*local=await readDungeonSnapshot\(db\);\s*verification=await verifyLocalSnapshot\(local\);/,'legacy saves still need a verified seal before uploading');
assert.match(cloudSyncSource,/cancelButton.hidden=fresh/,'case 3 offers exactly Drive or new game');
assert.match(cloudSyncSource,/localButton.textContent=fresh\?'新しく始める'/,'one choice dialog distinguishes new games from saved local players');
assert.match(app,/void cloudSyncController\?\.syncNow\?\.\(\)/,'name submission queues Drive upload without holding the local action lock');
assert.doesNotMatch(app,/await cloudSyncController\?\.syncNow\?\.\(\)/,'network uploads never block the rename form');
assert.match(app,/if\(profile\.awaitingHeir\)\{[\s\S]*?next=await saveHeirName\(db,name\);[\s\S]*?\}else\{[\s\S]*?await saveProfile\(db,next\);[\s\S]*?\}\s*profile=next;\s*closeDungeonDialog\(\$\('nameDialog'\)\);\s*render\(\);[\s\S]*?void cloudSyncController\?\.syncNow\?\.\(\)/,'both heir and ordinary names are saved locally, the dialog closes, then the cloud request starts');
assert.equal(page.split('システム上 <strong>'+concurrentWarning+'</strong>。').length-1,2,'both backup surfaces show the same explicit rollback warning');
assert.ok(page.indexOf('<p class="backup-sync-warning">'+copyWarning+'</p>')<page.indexOf('id="backupSetupStatus"'),'the initial warning precedes connection status');
const cloudMarkup=page.match(/<div class="cloud-sync">([\s\S]*?)<\/div>/)?.[1];
assert.ok(cloudMarkup,'backup section exists');
assert.ok(cloudMarkup.indexOf(copyWarning)<cloudMarkup.indexOf('id="googleDriveStatus"'),'save-loss warning is above the sync status');
assert.doesNotMatch(cloudMarkup,/<h3>Google Drive<\/h3>/,'redundant Google Drive heading does not repeat the synced status');
assert.match(cloudMarkup,/<p id="googleDriveStatus" role="status" aria-live="polite" aria-busy="false">未接続<\/p>/,'a single status provides connection state');
assert.match(page,/<span id="backupSetupSpinner" class="drive-sync-spinner" aria-hidden="true" hidden><\/span>/,'initial setup has a hidden-by-default progress spinner');
assert.match(page,/<span id="googleDriveSpinner" class="drive-sync-spinner" aria-hidden="true" hidden><\/span>/,'profile background backups use an inline progress spinner');
assert.match(page,/<div id="driveSyncActivity" class="drive-sync-activity" role="status" aria-live="polite" hidden>/,'nonblocking always-visible gameplay sync indicator exists');
assert.match(css,/\.drive-sync-activity\{[^\n]*pointer-events:none\}/,'floating Drive activity display does not block gameplay taps');
assert.match(css,/\.drive-sync-spinner\[hidden\]\{display:none!important\}/,'spinner never appears between syncs');
assert.match(css,/@keyframes drive-sync-spin/,'actual CSS spinner animation exists');
assert.match(app,/if\(!profile\.name\)openBackupSetup\(\)/,'new player setup remains explicit');
assert.match(page,/<button type="button" id="connectGoogleDrive"[^>]*>GoogleDriveに同期する<\/button>/,'profile sync button is short');
assert.match(page,/<button type="button" id="disconnectGoogleDrive" class="subtle" hidden>Google Driveの同期を解除<\/button>/,'profile exposes a hidden-until-connected disconnect button');
assert.match(css,/#disconnectGoogleDrive\[hidden\]\{display:none!important\}|#connectGoogleDrive\[hidden\],#disconnectGoogleDrive\[hidden\]/,'disconnect is not shown when disconnected');
assert.match(css,/\.cloud-sync-actions\{display:flex;flex-wrap:wrap/,'connection controls remain usable at mobile widths');
assert.match(page,/<button type="button" id="setupGoogleDrive"[^>]*>GoogleDriveに同期する<\/button>/,'pre-registration sync button matches profile');
assert.match(page,/<button type="button" id="setupWithoutBackup"[^>]*>同期せず始める<\/button>/,'local-only choice is clear');
const cloudSync=await read('assets/js/dungeon-cloud-sync.mjs');
assert.match(cloudSync,/if\(choice==='restore'\|\|choice==='overwrite'\)\{[\s\S]*?lockLocalOnly\(true\);[\s\S]*?\}\s*choicePending=false;\s*pendingChoiceCancel=null;\s*closeDungeonDialog\(conflictDialog\)/,'restore hides skip before the overlay chooser closes');
assert.match(cloudSync,/setSyncing\(true\);\s*show\('同期中…'\)/,'background sync marks real API work busy');
assert.match(cloudSync,/if\(again&&!stopped&&!restoring&&drive\)\{[\s\S]*?queueMicrotask\(\(\)=>\{if\(drive&&!stopped&&!restoring\)void sync\(false\)/,'at most one queued follow-up save starts immediately after active upload');
assert.match(cloudSync,/if\(busy\)\{again=true;return;\}/,'autosave edits during upload coalesce into one pending bit');
assert.match(cloudSync,/disconnectButton\?\.addEventListener\('click',\(\)=>\{void disconnect\(\);\}\)/,'unlink action waits without blocking gameplay');
assert.match(cloudSync,/if\(disconnectPending\)\{\s*finishDisconnect\(\)/,'unlink happens only in the active request finalizer');
assert.match(cloudSync,/requestController=null; \/\/ No abort: all in-flight requests have settled/,'normal unlink no longer aborts Drive uploads');
assert.match(cloudSync,/if\(await confirmOverwrite\(\)&&!disconnectPending&&conflictDialog\.open\)finish\('overwrite'\)/,'overwriting requires a second confirmed choice and active authorization');
assert.match(cloudSync,/connectionEpoch\+\+;/,'old connection callbacks are invalidated');
assert.match(cloudSync,/if\(!isCurrent\(activeSyncEpoch\)\)return 'deferred';/,'stale network results cannot restore connected UI');
assert.match(cloudSync,/clearAuthCookie\(\);\s*drive=null;expires=0;validatedDrive=null;/,'unlink removes token while preserving data');
assert.match(cloudSync,/setSyncing\(false\);\s*\}\s*\}\s*\}/,'busy spinner is cleared once the pending queue is drained');
assert.doesNotMatch(page,/起動・再接続時は保存日時で後勝ち判定/,'implementation jargon is not shown to users');
assert.match(css,/\.profile-data-actions \.backup-sync-warning\{[\s\S]*?color:#ff7777/,'backup loss and rollback text remains visibly red');

assert.match(page,/<dialog id="imageRepairDialog"/,'recapture dialog exists');
assert.match(app,/load\(\)\.catch\(failStartup\)/,'startup errors remain visible inside the loading overlay');
assert.match(app,/await cloudSyncController\?\.disconnect\?\.\(\);\s*await restoreDungeonXpMigrationBackup\(db\);/,'manual XP recovery unlinks Drive before local rollback so cloud cannot silently undo recovery');
const store=await read('assets/js/dungeon-store.mjs');
const core=await read('assets/js/dungeon-core.mjs');
const picker=await read('assets/js/dungeon-preparation-ui.mjs');
for(const specifier of app.matchAll(/from ['"]\.\/([^'"]+\.mjs)(\?[^'"]*)?['"]/g)){
 assert.equal(specifier[2],specifier[1]==='dungeon-tuning.mjs'?undefined:'?v='+currentRelease,'stale entry module '+specifier[1]);
}
assert.match(core,/from '\.\/dungeon-tuning\.mjs'/);
assert.ok(store.includes("from './dungeon-core.mjs?v="+currentRelease+"'"),
 'storage conversion uses the current, cache-busted XP core');
assert.ok(cloudSync.includes("from './dungeon-store.mjs?v="+currentRelease+"'"),
 'Drive sync and gameplay share one cache-busted save module');
assert.match(picker,/from '\.\/dungeon-loadout\.mjs'/);
assert.match(picker,/itemEffectIcons\(value\)/,'preparation item tiles share battle/reward effect formatting');
assert.doesNotMatch(picker,/picker-equipped|✓ 選択中/,'circle picker no longer renders a selected badge');
assert.match(picker,/aria-pressed="'\+selected/,'selected circles remain accessible');
assert.match(css,/\.picker-option\.picker-current\{/,'the focused slot keeps its stronger glowing frame');
assert.doesNotMatch(css,/\.picker-equipped/,'unused badge styles are removed');
assert.doesNotMatch(app,/魔法陣を保存した。性能は初回使用時に判明する。/);
assert.doesNotMatch(app,/鑑定/);
assert.doesNotMatch(picker,/鑑定/);
assert.match(app,/battle-spell-photo.*data-circle-photo-id/,'battle tiles request deferred image thumbnails');
assert.doesNotMatch(app,/battleImageUrl\(c\.image\)/,'battle no longer creates original photo URLs eagerly');
assert.match(app,/Math\.max\(G\.capacity\(profile\.level\),run\.carry\.findLastIndex\(Boolean\)\+1\)/,'combat item slots follow equipped capacity and retain occupied legacy slots');
assert.match(app,/renderHeroName\(hero\)/,'life ruby readiness appears beside the player name');
assert.match(app,/Boolean\(profile\?\.run\|\|returnFlow\)/,'return ceremony remains an active dungeon scene');
assert.match(app,/profile\.pendingReturn=returnFlow/,'uncompleted rewards survive tab browsing and reload');
assert.match(app,/profile\.pendingReturn=null/,'completion clears pending return');
assert.match(app,/collectionSort:'common'/,'collection sorting defaults to ascending rarity');
assert.match(app,/itemEffectIcons\(item\)/,'battle slots use compact item-effect icons');
assert.match(app,/run\.carry\.findLastIndex\(Boolean\)\+1/,'combat shows capacity slots plus any occupied legacy slots');
assert.match(app,/itemEffectIcons\(reward.item\)/,'return cards use the same item-effect icons');
assert.match(app,/statusBadges\(unit\.statuses,masters\.buffs,esc\)/,'combat statuses render as icons');
assert.match(app,/step=>steps\.push\(step\)/,'game engine steps are captured for sequential playback');
assert.match(app,/await animateBattle\(steps\)/);
assert.ok(app.includes('await playCombatSequence(steps,phase=>'));
assert.ok(app.includes('for(const step of phase)'),'both fighters are painted within one phase');
assert.ok(app.includes("treasureChestMarkup(drops)"),'drop count controls number of chests');
assert.ok(app.includes("dropCount?dropCount+'個 · 未確定':'次の戦いへ',dropCount"),'loot ceremony counts ordinary rewards and recovered legacies');
assert.ok(app.includes("await ceremony('encounter'"),'battle begins with an encounter');
assert.ok(app.includes("onFatal:side=>ceremony(side==='hero'?'hero-death':'enemy-death'"),'fatal ceremony overlaps the last attack');
assert.match(app,/const step=\(role,amount\)=>/,'consumable effect animation');


assert.ok(app.includes('circles=newestCirclesFirst([...circles,analyzed])'),'successful captures sort newest first');
assert.ok(app.includes('await putCircle(db,analyzed)'),'save only after successful camera analysis');
assert.match(app,/await analyzeCapturedCircle\(circle,creationInkCount\)/,'camera keeps chosen ink count');
assert.match(app,/inkEnhancedAnalysis\(reduced,inkCount\)[\s\S]*?savePreanalysis\(circle,enhanced\)[\s\S]*?else await putCircle\(db,analyzed\)/,'ink modifies base before saving');
assert.match(app,/await saveProfileWithCircles\(db,nextProfile,\[analyzed\]\)/,'ink and circle save atomically');
assert.doesNotMatch(app,/circleTitle|魔法陣 '\+String/);
assert.match(app,/newestCirclesFirst\(\(await allCircles\(db\)\)\.map\(withDrawnPowerFloor\)\)/,'older drawn circles load with 250 minimum');
assert.match(app,/finish\(null,normalizeAnalysisResult\(\{/,'capture parser returns unscaled data to avoid scaling twice');
assert.match(app,/const reduced=result\.failed\?result\.analysis:circle\.origin==='drawn'\?\{\.\.\.result\.analysis,power:drawnPower\(result\.analysis\.power\)\}:successfulDungeonAnalysis\(result\.analysis\)/,'capture failure keeps raw 200..250; successful captures use scale');
assert.match(app,/Object\.assign\(circle,savePreanalysis\(circle,result\.failed\?result\.analysis:circle\.origin==='drawn'\?/,'deferred failure retains raw power; successful first analysis scales');
assert.match(app,/\.\.\.\(circle\.origin==='drawn'\?\{powerScaleVersion:2\}:\{\}\)/,'new drawn spells are marked to preserve sub-250 results across reloads');
assert.match(app,/circle\.origin==='drawn'\?\{powerScaleVersion:2\}:\{\}\);/,'legacy deferred analysis gets the same compatibility marker');
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
for(const [rarity,name] of [['common','コモン'],['uncommon','アンコモン'],
 ['rare','レア'],['epic','エピック'],['legendary','レジェンダリー']]){
 assert.ok(app.includes(rarity+":'"+name+"'"),rarity+' keeps a readable accessibility name');
 assert.match(css,new RegExp('\\.relic-card\\.discovered\\[data-rarity="'+rarity+'"\\]\\{[\\s\\S]*?--rarity-ink:#[0-9a-f]{6};--rarity-glow:#[0-9a-f]{8}'),rarity+' keeps its colored rarity aura');
}
assert.match(app,/collectionRarityMarks\(rarity\)/,'collection rarity is displayed as asterisks instead of names');
assert.match(app,/\+\(found\?'<span class="relic-rarity" aria-hidden="true">'/,'stars only appear for discovered collectibles');
assert.match(page,/<select id="collectionRarityFilter"><option value="all">すべて<\/option><option value="common">コモン<\/option><option value="uncommon">アンコモン<\/option><option value="rare">レア<\/option><option value="epic">エピック<\/option><option value="legendary">レジェンダリー<\/option><\/select>/,'rarity dropdown options remain unchanged');
assert.ok(app.includes(`data-rarity="'+(found?rarity:'unknown')`),'unfound relics still hide their rarity');
assert.equal(css.includes('/* Color-vision accessibility:'),false,'previous flat, no-glow frame redesign must be removed');
assert.match(css,/\.relic-card\.discovered \.relic-art\{[\s\S]*?box-shadow:0 0 0 9px var\(--rarity-halo\),[\s\S]*?0 0 32px var\(--rarity-glow\)/,'original luminous halo and bloom are restored');
assert.match(css,/\.relic-card\.discovered \.relic-glyph\{[\s\S]*?text-shadow:0 0 20px var\(--rarity-glow\)/,'glyph keeps colorful glow');
assert.doesNotMatch(css.slice(css.indexOf('/* Restore the collection'),css.indexOf('/* Combat presentation:',css.indexOf('/* Restore the collection'))),/border-style\s*:|border-width\s*:|border:\s*\d+px/,'new rarity treatment does not modify frame patterns or widths');
assert.match(css,/\.relic-card\{[^}]*border:1px solid var\(--border\)/,'the original outer card frame is unchanged');
assert.match(css,/\.relic-art\{[^}]*border:1px solid #e1c58b77/,'the original circular frame thickness stays unchanged');
assert.match(css,/\.relic-card\.discovered \.relic-rarity\{[\s\S]*?font-size:14px/,'rarity labels remain readable');
assert.match(page,/<h2>プロフィール<\/h2>/,'profile heading matches the tab');
assert.match(css,/@keyframes circle-upgrade-aura/,'upgrades have a ritual animation');
assert.match(page,/id="deleteSaveData"[^>]*data-action="delete-data"/,'profile has a full save deletion action');
assert.match(page,/id="deleteDataDialog"/,'data reset is confirmed');
assert.match(page,/id="deleteDataPhrase"/,'data reset requires typing a confirmation word');
assert.match(app,/await cloudSyncController\?\.disconnect\?\.\(\);\s*await clearDungeonData\(db\)/,'account deletion disconnects and clears auth cookie before erasing local data');
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
assert.ok(app.includes("const terminalSwap=['checkpoint','result','returnShowcase'].includes(name)"),'short end scenes do not crossfade against the tall battle panel');
assert.match(css,/@keyframes terminal-fade-in\{from\{opacity:0\}to\{opacity:1\}\}/,'end screens fade opacity only');
const deathOverlayFrames=css.match(/@keyframes ceremony-arrive\{([^\n]+)\}/)?.[1]||'';
assert.ok(deathOverlayFrames&&!deathOverlayFrames.includes('transform:'),'fatal overlay must not shrink or enlarge during transition');
assert.match(css,/\.scene-stack > #checkpoint\.panel:not\(\[hidden\]\)/,'checkpoint transition does not overlap the old battle');
assert.match(css,/\.scene-stack > #result\.panel:not\(\[hidden\]\)/,'defeat and return transition does not overlap the old battle');
const battleMarkup=page.match(/<section id="battle"[^>]*>([\s\S]*?)<\/section>/)?.[1]||'';
assert.ok(battleMarkup.indexOf('id="battleInfo"')>battleMarkup.indexOf('id="battleArena"')&&
 battleMarkup.indexOf('id="battleInfo"')<battleMarkup.indexOf('<h3>魔法陣</h3>'),'pending loot and EXP appear above the magic-circle heading');
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
assert.match(app,/await analyzeCapturedCircle\(circle,creationInkCount\)/,'camera waits for analysis while preserving ink count');
assert.match(app,/await revealOriginal\(analyzed,result\.failed\)/,'both results use the original reveal');
assert.match(app,/const request=\{id:circle\.id,type:'capture',epoch:photoAnalysisEpoch,origin:circle\.origin\}/,
 'analysis retains whether capture came from handwritten editor');
assert.match(app,/const drawn=capture&&request\.origin==='drawn';[\s\S]*?if\(drawn\)\{\s*cameraReturnScroll=null;\s*show\('library'\);\s*drawingEditor\.resume\(\);\s*\}else if\(capture\)\{show\('library'\);returnToCameraScroll\(\);openCircleCamera\(\);\}/,
 'cancelled handwriting resumes editor, camera capture returns to modal');
assert.doesNotMatch(page,/id="analysisMisfire"/,'no extra result format is introduced');
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
assert.match(app,/circleEffectDetails\(circle,masters\.buffs,G\.statusDuration\)/,'magic-circle detail shows power-derived duration');
assert.match(app,/\['追加効果の詳細',info\.statusDescription\]/);
assert.match(css,/\.circle-card-info\{[^}]*display:flex/);
assert.match(css,/\.circle-card-stats\{[^}]*font-size:/);
const thumbnails=await read('assets/js/dungeon-preparation-ui.mjs');
assert.match(thumbnails,/class="circle-card-symbols"/);
assert.doesNotMatch(thumbnails,/class="circle-card-status"/,'named effects are detail-only');
assert.doesNotMatch(css,/\.circle-card-status/,'obsolete status-row styling removed');
assert.match(thumbnails,/class="circle-card-mp">MP:/);
assert.match(thumbnails,/class="circle-card-power">威力:/);
assert.match(css,/\.circle-grid \.card-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'grimoire detail and delete side-by-side');
assert.match(css,/\.circle-card-mp,\.circle-card-power\{[^}]*white-space:nowrap/,'stats stay on their own lines');
assert.match(app,/createDungeonPhotoManager\(/,'photo manager keeps visible thumbnail URLs through repeated turns');
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
assert.match(css,/#battleArena \.unit\{\s*height:288px;min-height:288px;max-height:288px/,'both combatants have fixed identical desktop height');
assert.match(css,/#battleArena \.unit\{\s*height:250px;min-height:250px;max-height:250px/,'both combatants have fixed identical mobile height');
assert.match(css,/#battleArena \.unit-info\{\s*width:100%;min-width:0;min-height:0;flex:1;\s*display:grid;grid-template-rows:56px minmax\(0,1fr\)/,'both names reserve the exact same fixed row height');
assert.match(css,/#battleArena \.unit-info h3\{[\s\S]*?white-space:normal;overflow-wrap:anywhere;[\s\S]*?-webkit-line-clamp:2/,'long names wrap over two lines instead of escaping the card');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*width:100%;min-width:0;min-height:0;display:grid;\s*grid-template-rows:34px 34px 33px minmax\(0,1fr\)/,'both sides align HP, MP and MAG/DEF/RES rows');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*min-width:0;min-height:0;flex:1;overflow:visible/,'status area stops scrolling');
assert.match(css,/#battleArena #enemyStats>\.effects,#battleArena #heroStats>\.effects\{\s*display:flex/,'compact icons form one horizontal status row');
assert.doesNotMatch(css,/#battleArena #enemyStats,#battleArena #heroStats\{[^}]*overflow-y:auto/,'no hidden per-combatant stats scrollbars');
assert.match(css,/#battleArena \.combat-attributes\{\s*min-width:0;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,'MAG, DEF and RES are in separate columns');
assert.match(app,/function rowUnit\(unit\)\{[\s\S]*?class="battle-vital"[\s\S]*?class="combat-attributes"[\s\S]*?class="combat-attribute"/,'fighter HP/MP and attributes use non-wrapping, compact markup');

// Portraits are smaller within the SAME fixed-height cards; reserve a physical
// margin between glowing glyphs and two-line names on both mobile and desktop.
assert.match(css,/#battleArena \.unit \.enemy-portrait,#battleArena \.unit \.hero-portrait\{\s*box-sizing:border-box;width:100%;height:64px;flex:0 0 64px;[\s\S]*?margin:0 0 14px;font-size:46px/,'desktop combat portraits leave 14px between icon area and names');
assert.match(css,/#battleArena \.unit \.enemy-portrait,#battleArena \.unit \.hero-portrait\{\s*height:44px;flex-basis:44px;margin-bottom:12px;font-size:36px/,'mobile combat portraits leave a 12px gap above names');
assert.match(css,/#battleArena \.unit\{\s*height:288px;min-height:288px;max-height:288px/,'spacing does not increase desktop fighter box height');
assert.match(css,/#battleArena \.unit\{\s*height:250px;min-height:250px;max-height:250px/,'spacing does not increase mobile fighter box height');
assert.match(css,/#battleArena \.unit-info\{\s*width:100%;min-width:0;min-height:0;flex:1;\s*display:grid;grid-template-rows:56px minmax\(0,1fr\)/,'left and right names and levels reserve the same row');
assert.match(css,/#battleArena \.combatant-heading\{\s*min-width:0;display:grid;grid-template-rows:38px 18px/,'the level stays in its own row even when a name wraps');
assert.match(css,/#battleArena \.combatant-level\{\s*display:block;min-width:0;font:600 12px\/18px/,'the level has a fixed readable line');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*width:100%;min-width:0;min-height:0;display:grid;\s*grid-template-rows:34px 34px 33px minmax\(0,1fr\)/,'HP/MP and attributes stay vertically aligned');

/* Glow is drawn outside the short icon track, without changing layout. */
assert.match(css,/#battleArena \.enemy-portrait,\s*#battleArena \.hero-portrait\{\s*background:none;\s*isolation:isolate/,'remove the portrait-sized clipped radial backgrounds');
assert.match(css,/#battleArena \.enemy-portrait::before,[\s\S]*?#battleArena \.hero-portrait::before\{\s*content:"";position:absolute;inset:-17px 0 -19px;z-index:-1/,'enemy and hero glows extend vertically without enlarging their icons');
assert.match(css,/background:radial-gradient\(ellipse 37% 51% at 50% 61%,\s*var\(--portrait-aura\)/,'portrait glow is a soft vertical ellipse');
assert.match(css,/#battleArena \.enemy-portrait\{--portrait-aura:rgba\(167,73,100,\.53\)\}/,'enemy keeps rosy aura');
assert.match(css,/#battleArena \.hero-portrait\{--portrait-aura:rgba\(57,143,159,\.56\)\}/,'hero keeps cool aura');
assert.match(css,/#battleArena \.unit\{\s*height:288px;min-height:288px;max-height:288px/,'desktop frames remain equal fixed height, slightly shorter');
assert.match(css,/#battleArena \.unit\{\s*height:250px;min-height:250px;max-height:250px/,'mobile frames remain equal fixed height, slightly shorter');
assert.match(css,/#battleArena #enemyStats,#battleArena #heroStats\{\s*grid-template-rows:31px 31px 33px minmax\(0,1fr\)/,'matching mobile HP, MP and attribute rows leave room for status effects');
assert.match(css,/\.relic-card\.discovered\[data-rarity="common"\] \.relic-art\{box-shadow:none\}/,'only common loses the surrounding aura');
assert.match(css,/\.relic-card\.discovered\[data-rarity="common"\] \.relic-glyph,[\s\S]*?\.relic-card\.discovered\[data-rarity="common"\] \.relic-rarity\{text-shadow:none\}/,'common text does not glow');
for(const rarity of ['uncommon','rare','epic','legendary']){
 assert.match(css,new RegExp('\\.relic-card\\.discovered\\[data-rarity="'+rarity+'"\\]\\{[\\s\\S]*?--rarity-glow:#[0-9a-f]{8}'),rarity+' keeps its colorful glow');
}
assert.match(css,/\.relic-card\.discovered \.relic-art\{[\s\S]*?0 0 32px var\(--rarity-glow\)/,'rarer halo remains intact');

assert.match(css,/background:radial-gradient\(ellipse 37% 51% at 50% 61%,/,'portrait glow is visually centered below the icon instead of above it');
assert.match(css,/\.relic-card\.discovered:not\(\[data-rarity="common"\]\) \.relic-art\{[\s\S]*?0 0 22px 7px var\(--rarity-halo\),[\s\S]*?0 0 46px 8px var\(--rarity-glow\)/,'rarer glows use soft diffuse halos rather than hard rings');
assert.match(css,/\.relic-art \.relic-glyph\{[\s\S]*?display:flex;align-items:center;justify-content:center;[\s\S]*?transform:translateY\(-\.035em\)/,'collection symbols are centered independently of font baselines');
assert.match(css,/\.relic-card\.discovered\[data-rarity="common"\] \.relic-art\{box-shadow:none\}/,'common remains without glow');

const svgSource=await read('assets/js/dungeon-relic-symbols.mjs');
assert.match(svgSource,/export const relicSymbols/,'collection icons are SVG');
assert.match(svgSource,/viewBox="0 0 100 100"/,'same viewBox for all collection icons');
assert.match(css,/\.relic-art \.relic-symbol\{\s*display:block;width:78%;height:78%;margin:auto/,'collection SVG centered in circular art');
const appSource=await read('assets/js/dungeon-app.mjs');
assert.match(appSource,/relicSymbolSvg\(i,found\)/,'collection uses SVG renderer');
assert.doesNotMatch(appSource,/const relics=\[/,'old font glyphs removed');
console.log('PASS camera circle guide, layer progression, 3-column items, readable story, terminology and fantasy layout');
