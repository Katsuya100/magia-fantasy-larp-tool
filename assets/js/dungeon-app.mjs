import * as G from './dungeon-core.mjs?v=20261018.27';
import {playCombatSequence,playBattleCeremony,effectCaption,effectDuration,bossCeremonyTier,ceremonyDuration,treasureChestMarkup} from './dungeon-combat-fx.mjs?v=20261018.27';
import {canDepartWithCircles,circleSummary,circleDetails,isRevealed,revealOnUse,newCapturedCircle,savePreanalysis,normalizeAnalysisResult,circleEffectDetails} from './dungeon-magic-knowledge.mjs?v=20261018.27';
import {prepareCircles,prepareItems,setSlot,pickedValues,isFull,ensureItemInstances,saveCarrySlots,restoreCarrySlots,validCarrySlots} from './dungeon-loadout.mjs?v=20261018.27';
import {spellGrid,itemGrid,circleChoices,itemChoices,circleEffectBadges,itemSymbol,itemEffectText,itemEffectIcons} from './dungeon-preparation-ui.mjs?v=20261018.27';
import {circleListIndexes,itemListIndexes,collectionListIndexes} from './dungeon-list-view.mjs?v=20261018.27';
import {relicSymbolSvg} from './dungeon-relic-symbols.mjs?v=20261018.27';
import {newestCirclesFirst,nextCircleRegistration} from './dungeon-circle-order.mjs?v=20261018.27';
import {configure,num,floor as floorMaster} from './dungeon-tuning.mjs';
import {enemyForFight,layerForFight,shuffledLayerEnemyIds,isBonusLayer,bonusCollection,bonusConsumable} from './dungeon-design.mjs?v=20261018.27';
import {FIGHTS_PER_LAYER,isLayerBoss,encounterLabel,battleHeading,battleEncounter,clearedLayer,recordReturnedLayer,deepestReturnedLayer} from './dungeon-progress.mjs?v=20261018.27';
import {upgradeCircle,savedUpgrade} from './dungeon-upgrades.mjs?v=20261018.27';
import {openStore,allCircles,putCircle,deleteCircle,saveProfile,getProfile,clearDungeonData} from './dungeon-store.mjs?v=20261018.27';
import {createCircleImageUrls} from './dungeon-image-urls.mjs?v=20261018.27';
import {RETURN_XP_DURATION_MS,returnXpFrame} from './dungeon-return-fx.mjs?v=20261018.27';
import {highestRankLayer,rankTitle,rankBadgeName,unlockedStartLayers,allowedStartLayer,rankBadgeDrop,acquireAdventurerRank} from './dungeon-ranks.mjs?v=20261018.27';
import {statusBadges} from './dungeon-status-ui.mjs?v=20261018.27';
import {supportPromptForReturn} from './dungeon-support.mjs?v=20261018.27';
import {adventurerShareData,adventurerShareText,adventurerXUrl,paintAdventurerCard,DUNGEON_SHARE_URL} from './dungeon-share.mjs?v=20261018.27';
import {initCircleTutorial} from './dungeon-tutorial.mjs?v=20261018.27';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,circles=[],masters={},slots=[],carry=[],stream=null,activeAnalysis=null,picker=null,selectedStartLayer=null;
const listView={
 libraryRole:'all',libraryAttribute:'all',librarySort:'newest',
 collectionDiscovery:'all',collectionRarity:'all',collectionSort:'common',
 pickerFilter:'all',pickerSort:'newest'
};
const pickerView={circle:{filter:'all',sort:'newest'},item:{filter:'all',sort:'default'}};
const circleImages=createCircleImageUrls();
let dungeonView='prepare';
let busyAction=false,playingEffects=false;
let photoAnalysisEpoch=0,lastCaptureRegistration=0,cameraReturnScroll=null,pendingCircleAction=null;
let returnFlow=null,returnAnimationToken=0,tutorial=null;
async function exclusive(fn){if(busyAction)return;busyAction=true;try{return await fn();}finally{busyAction=false;}}
function note(message){
 const targets=['pageError','battleError','cameraError'];
 for(const id of targets){$(id).hidden=true;$(id).textContent='';}
 if(!message||!/できません|失敗|不足|見つからない|不正|中断|対応ブラウザ|開けません|起動できません|してください/.test(message))return;
 const target=/カメラ|撮影|HTTPS|localhost/.test(message)?'cameraError':profile?.run?'battleError':'pageError';
 $(target).textContent=message;$(target).hidden=false;
}
async function persist(){await saveProfile(db,profile);}
function startupStage(message){$('startupDetail').textContent=message;}
function finishStartup(){
 $('dungeonApp').removeAttribute('inert');
 $('dungeonApp').setAttribute('aria-busy','false');
 $('startupMask').setAttribute('aria-busy','false');
 $('startupMask').hidden=true;
}
function failStartup(error){
 console.error(error);
 $('startupTitle').textContent='迷宮の扉が開かなかった';
 startupStage('読み込みに失敗しました：'+String(error?.message||error));
 $('startupMask').dataset.state='error';
 $('startupMask').setAttribute('aria-busy','false');
 $('startupRetry').hidden=false;
 $('startupRetry').focus();
 note('起動できません：'+String(error?.message||error));
}
async function load(){
 $('startupMask').focus();
 startupStage('冒険の記録を確かめている…');
 db=await openStore();
 const files={enemies:'dungeon-enemies.csv',items:'dungeon-consumables.csv',collections:'dungeon-collections.csv',buffs:'dungeon-buffs.csv',balance:'dungeon-balance.csv',levels:'dungeon-levels.csv',floors:'dungeon-floors.csv',playerBase:'dungeon-player-base.csv'};
 const entries=Object.entries(files);
 for(const [index,[key,file]] of entries.entries()){
  startupStage('迷宮の資料を読み込んでいる… '+(index+1)+' / '+entries.length);
  const res=await fetch('assets/data/'+file);
  if(!res.ok)throw Error(file+' の取得に失敗');
  masters[key]=G.parseCsv(await res.text());
 }
 startupStage('迷宮の掟を読み解いている…');
 configure(masters);
 G.validateMasters(masters.enemies,masters.items,masters.collections,masters.buffs);
 startupStage('冒険者の記録を整えている…');
 profile=await getProfile(db);
 returnFlow=Array.isArray(profile.pendingReturn?.steps)&&profile.pendingReturn.steps.length?profile.pendingReturn:null;
 if(!Array.isArray(profile.obtainedItemIds))profile.obtainedItemIds=[...new Set([...(profile.inventory||[]),...(profile.run?.carry||[])].filter(Boolean).map(item=>item.id).filter(Boolean))];
 G.repairInvalidMp(profile.run?.hero);
 profile.adventurerRank=highestRankLayer(profile);
 profile.defeatedBosses??={};
 for(const relic of masters.collections)if(relic.boss_enemy_id&&Number(profile.collection?.[relic.id]||0)>0)profile.defeatedBosses[relic.boss_enemy_id]=true;
 profile.magicStones=Math.max(0,Number(profile.magicStones)||0);
 profile.deepestReturnedLayer=deepestReturnedLayer(profile);
 startupStage('魔導書の頁を並べている…');
 circles=newestCirclesFirst(await allCircles(db));
 slots=prepareCircles(profile.slots,circles.map(c=>c.id),num('spell_slots'));
 ensureItemInstances(profile);
 if(!profile.run)profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 carry=profile.run?prepareItems([],profile.inventory.length,G.capacity(profile.level)):restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 startupStage('迷宮の扉を開いている…');
 await persist();
 wire();
 render();
 if(profile.run){if(profile.run.stage==='checkpoint')renderCheckpoint();else renderRun();}
 if(returnFlow)renderReturnStep();
 show(returnFlow?'returnShowcase':profile.run?(profile.run.stage==='checkpoint'?'checkpoint':'battle'):'prepare');
 finishStartup();
 if(!profile.name)openNameDialog(true);
 else if(!profile.tutorialDone&&!circles.length&&!profile.attempts&&!profile.run)tutorial.open();
}
const dungeonScenes=new Set(['prepare','library','battle','checkpoint','analyzing','result','returnShowcase']);
function rememberCameraScroll(){
 cameraReturnScroll=typeof window.scrollY==='number'?window.scrollY:(window.pageYOffset||0);
}
function returnToCameraScroll(){
 if(cameraReturnScroll===null)return;
 const top=cameraReturnScroll;
 cameraReturnScroll=null;
 // Restore after the grimoire section is visible and its card layout has been rebuilt.
 const restore=()=>window.scrollTo?.(0,top);
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(restore));
 else restore();
}
const sceneIds=['home','library','prepare','collection','battle','checkpoint','analyzing','result','returnShowcase'];
let activeScene='prepare',sceneFadeTimer=null;
function resolvedView(name){
 const exploring=Boolean(profile?.run||returnFlow);
 if(name==='dungeon')name=returnFlow?'returnShowcase':exploring?(activeAnalysis?'analyzing':profile.run.stage==='checkpoint'?'checkpoint':'battle'):'prepare';
 if(exploring&&(name==='prepare'||name==='library'))name=returnFlow?'returnShowcase':profile.run.stage==='checkpoint'?'checkpoint':'battle';
 return name;
}
function applyView(name,retained=null){
 // Reward and EXP scenes still belong to the dungeon until 完了 is pressed.
 const exploring=Boolean(profile?.run||returnFlow);
 activeScene=name;
 if(dungeonScenes.has(name))dungeonView=name;
 for(const id of sceneIds)$(id).hidden=id!==name&&id!==retained;
 $('tab-prepare').hidden=exploring;
 $('tab-library').hidden=exploring;
 $('tab-dungeon').hidden=!exploring;
 const selected=exploring?(dungeonScenes.has(name)?'dungeon':name):(
  name==='library'||name==='analyzing'&&activeAnalysis?.type==='capture'?'library':
  name==='collection'?'collection':
  name==='home'||name==='returnShowcase'?'home':'prepare'
 );
 for(const tab of ['prepare','library','dungeon','collection','home']){
  const b=$('tab-'+tab);
  if(tab===selected)b.setAttribute('aria-current','page');
  else b.removeAttribute('aria-current');
 }
 if(['home','library','prepare','collection'].includes(name))render();
 if(name==='battle'&&profile?.run&&!playingEffects)renderRun();
}
function show(requested){
 // Crossfade just the scene stack. Root View Transitions resize the whole page
 // when scenes differ in height, causing momentary zoom and black letterboxing.
 if(sceneFadeTimer!==null){
  clearTimeout(sceneFadeTimer);
  sceneFadeTimer=null;
  for(const id of sceneIds){
   $(id).hidden=id!==activeScene;
   delete $(id).dataset.entering;
   delete $(id).dataset.exiting;
  }
 }
 const name=resolvedView(requested);
 const before=sceneIds.find(id=>!$(id).hidden);
 const reduced=typeof window.matchMedia!=='function'||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 // Never overlap the tall battle and compact checkpoint/result in one grid
 // track: hiding the tall scene later would suddenly change viewport height.
 const terminalSwap=['checkpoint','result','returnShowcase'].includes(name)||['checkpoint','result','returnShowcase'].includes(before);
 if(terminalSwap&&before!==name&&(before==='battle'||name==='returnShowcase'))scrollToDungeonTabs();
 if(!before||before===name||reduced||terminalSwap||!sceneIds.includes(name)){
  applyView(name);
  return;
 }
 // Keep both DOM panels painted in the same grid cell until fading finishes.
 applyView(name,before);
 $(before).dataset.exiting='true';
 $(name).dataset.entering='true';
 sceneFadeTimer=setTimeout(()=>{
  $(before).hidden=true;
  delete $(before).dataset.exiting;
  delete $(name).dataset.entering;
  sceneFadeTimer=null;
 },180);
}
function scrollToDungeonTabs(){
 $('tab-dungeon').closest('nav')?.scrollIntoView?.({behavior:'instant',block:'start'});
}
function restoreContinuedBattleScroll(top){
 if(!Number.isFinite(top)||top<0)return;
 const restore=()=>window.scrollTo?.(0,top);
 // Restore after the new fight has been painted, including viewport height.
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(restore));
 else restore();
}
function imageUrl(blob){return circleImages.get(blob);}
function battleImageUrl(blob){return circleImages.get(blob);}
function renderHeroName(hero){
 const name=$('heroName'),displayName=profile.name?.trim()||'名もなき冒険者';
 name.textContent=displayName+(hero.reviveArmed?' 🪽':'');
 if(hero.reviveArmed){
  name.setAttribute('title','生命の紅石：復活待機中');
  name.setAttribute('aria-label',displayName+'・生命の紅石：復活待機中');
 }else{
  name.removeAttribute('title');
  name.removeAttribute('aria-label');
 }
}
function rowUnit(unit){
 const hp=Math.max(0,100*unit.hp/unit.stats.hp),mp=Math.max(0,100*unit.mp/unit.maxMp);
 // Identical fixed tracks on both sides keep HP, MP and every attribute aligned.
 // Numeric attributes have separate columns so a wrapped RES value cannot push
 // the opposing combatant's statistics down.
 const vital=(label,current,max,percent,fillClass)=>'<div class="battle-vital"><span class="battle-vital-label">'+label+' '+current+'/'+max+'</span>'
  +'<div class="meter"><div class="fill '+fillClass+'" style="width:'+percent+'%"></div></div></div>';
 const attrs='<div class="combat-attributes">'
  +[['MAG',unit.stats.mag],['DEF',G.armor(unit)],['RES',unit.stats.res]]
   .map(([label,value])=>'<span class="combat-attribute"><span>'+label+'</span><strong>'+value+'</strong></span>').join('')
  +'</div>';
 const effects=unit.statuses.length?'<p class="effects" aria-label="状態効果">'+statusBadges(unit.statuses,masters.buffs,esc)+'</p>':'<p class="effects" aria-hidden="true"></p>';
 return vital('HP',unit.hp,unit.stats.hp,hp,'')
  +vital('MP',unit.mp,unit.maxMp,mp,'mp')+attrs+effects;
}
const roles={attack:'⚔️攻撃',defense:'🛡️防御',support:'✚回復',debuff:'🕸️弱体'};
function circleLabel(a,revealed=true){return esc(circleSummary({analysis:a,revealed},masters.buffs,G.mpCost));}
function itemName(item){return masters.items.find(x=>x.id===item.id)?.name||item.id;}
function roleText(text){return String(text).replace(/通常攻撃|攻撃|防御|弱体|回復/g,word=>({'通常攻撃':'⚔️通常攻撃',攻撃:'⚔️攻撃',防御:'🛡️防御',弱体:'🕸️弱体',回復:'✚回復'})[word]);}
function render(){
 carry=prepareItems(carry,profile.inventory.length,G.capacity(profile.level));

 const s=G.stats(profile.base,profile.level),atLevelCap=profile.level>=num('level_max'),experienceNeeded=atLevelCap?0:G.nextXp(profile.level),xpProgress=atLevelCap?100:Math.min(100,100*profile.xp/experienceNeeded);
 const name=esc(profile.name||'名もなき冒険者');
 $('playerStats').innerHTML='<div class="character-name-row"><h3 class="character-name">'+name+'</h3><button class="subtle" data-action="rename">名前変更</button></div>'
 +'<div class="level-line"><strong>Lv.'+profile.level+'</strong><span>'+(atLevelCap?'EXP MAX':'EXP '+profile.xp+' / '+experienceNeeded)+'</span></div><div class="xp-track" role="progressbar" aria-label="経験値" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(xpProgress)+'"><div class="xp-fill" style="width:'+xpProgress+'%"></div></div>'
 +'<div class="stat-grid">'+['hp','mag','def','res'].map(k=>'<div class="stat-cell"><small>'+k.toUpperCase()+'</small><strong>'+s[k]+'</strong></div>').join('')+'</div>'
 +'<p class="adventure-record">携行品上限：'+G.capacity(profile.level)+'個 ｜ 帰還 '+profile.returns+' ｜ 最深:'+(deepestReturnedLayer(profile)?deepestReturnedLayer(profile)+'層':'-')+'</p>'
  +'<p class="adventurer-grade">冒険者等級：<strong data-rank="'+highestRankLayer(profile)+'"><span>'+rankTitle(highestRankLayer(profile))+'</span></strong></p>';
 const obtained=masters.collections.filter(item=>Number(profile.collection[item.id]||0)>0).length;
 $('collectionProgress').innerHTML='<strong>'+obtained+' / '+masters.collections.length+'</strong><small>DISCOVERED</small><div class="collection-track"><div class="collection-fill" style="width:'+(100*obtained/masters.collections.length)+'%"></div></div>';
 // Collection symbols are rendered as centered SVG paths.
 // Shapes and readable names supplement color; unknown collection rarity stays hidden.
 const rarityLabels={common:'○ コモン',uncommon:'◇ アンコモン',rare:'◆ レア',
  epic:'✦ エピック',legendary:'★ レジェンダリー'};
 const collectionIndexes=collectionListIndexes(masters.collections,profile.collection,{
  discovery:listView.collectionDiscovery,rarity:listView.collectionRarity,sort:listView.collectionSort
 });
 $('collectionGrid').innerHTML=collectionIndexes.map(i=>{
  const item=masters.collections[i];
  const count=Number(profile.collection[item.id]||0),found=count>0;
  const rarity=['common','uncommon','rare','epic','legendary'].includes(item.rarity)?item.rarity:'common';
  const mark=relicSymbolSvg(i,found);
  return '<article class="relic-card '+(found?'discovered':'locked')+'" data-rarity="'+(found?rarity:'unknown')+'" role="listitem" aria-label="'+(found?esc(item.name)+'・'+rarityLabels[rarity]:'未発見の収集品')+'">'
   +(found?'<span class="relic-count">×'+count+'</span>':'')
   +'<div class="relic-art" aria-hidden="true">'+mark+'</div>'
   +(found?'<span class="relic-rarity">'+rarityLabels[rarity]+'</span>':'')
   +'<div class="relic-name">'+(found?esc(item.name):'？？？')+'</div>'
   +'<p class="relic-detail">'+(found?esc(item.description):'未発見')+'</p></article>';
 }).join('')||'<p class="collection-empty">該当するコレクションはありません。</p>';
 $('magicStoneBalance').textContent='✦ 魔導石：'+profile.magicStones+'個';
  const circleIndexes=circleListIndexes(circles,{
   role:listView.libraryRole,attribute:listView.libraryAttribute,sort:listView.librarySort
  });
  $('libraryCards').innerHTML=circleIndexes.map(i=>circles[i]).map(c=>'<article class="card" data-circle-id="'+esc(c.id)+'"><img alt="魔法陣" src="'+imageUrl(c.image)+'">'+circleEffectBadges(c,masters.buffs,esc,G.mpCost)+'<div class="card-actions"><button type="button" class="subtle magic-expand" data-circle-detail="'+esc(c.id)+'">詳細</button><button type="button" class="subtle" data-remove="'+esc(c.id)+'" '+(profile.run?'disabled':'')+'>削除</button><button type="button" class="subtle upgrade-action" data-upgrade="'+esc(c.id)+'" '+(profile.run||!isRevealed(c)||profile.magicStones<1?'disabled':'')+'>✦ 魔導石で強化</button></div></article>').join('')||'<p class="collection-empty">'+(circles.length?'条件に合う魔法陣はありません。':'魔導書はまだ白紙。')+'</p>';
 $('slotCards').innerHTML=spellGrid(slots,circles,imageUrl,esc,!profile.run,masters.buffs,G.mpCost);
 const unlocked=profile.returns>0,limit=G.capacity(profile.level);
 $('gearCards').innerHTML=itemGrid(carry,profile.inventory,limit,unlocked,itemName,esc,!profile.run);
 $('gearCounter').textContent=unlocked?'携行品 '+pickedValues(carry.slice(0,limit)).length+' / '+limit+' 個':'携行品：最初の帰還後に解放';
 selectedStartLayer=selectedStartLayer===null?unlockedStartLayers(profile).at(-1):allowedStartLayer(profile,selectedStartLayer);
 $('startLayer').innerHTML=unlockedStartLayers(profile).map(layer=>'<option value="'+layer+'">'+(layer===1?'1層から':layer+'層から（'+rankTitle(layer-1)+'）')+'</option>').join('');
 $('startLayer').value=String(selectedStartLayer);
 $('startLayer').disabled=Boolean(profile.run);
 $('startLayerHint').textContent=highestRankLayer(profile)?'取得済みの冒険者章に応じて開始階層を選択できます。':'10層ごとの冒険者章を獲得すると開始階層が増えます。';
 $('startAttack').disabled=!canDepartWithCircles(slots)||Boolean(profile.run);
 $('deleteSaveData').disabled=Boolean(profile.run);
 $('circleCounter').textContent='魔法陣 '+slots.filter(Boolean).length+' / 3〜5 個';
}
function rewardLedgerMarkup(run){
 return '<div class="battle-stat" data-kind="loot">'
   +'<span class="battle-stat-label"><span aria-hidden="true">✥</span> 戦利品</span>'
   +'<strong class="battle-stat-value">'+run.loot.length+'</strong>'
   +'<small>帰還時に確定</small></div>'
  +'<div class="battle-stat" data-kind="xp">'
   +'<span class="battle-stat-label"><span aria-hidden="true">✧</span> 獲得EXP</span>'
   +'<strong class="battle-stat-value">+'+run.xp+'</strong>'
   +'<small>帰還時に確定</small></div>';
}
function renderRun(){
 const run=profile.run;if(!run)return;
 const enemy=run.enemy,hero=run.hero;
 $('floorLabel').textContent=battleHeading(run.floor);
 $('battleEncounterLabel').textContent=battleEncounter(run.floor);
 $('enemyName').textContent=run.enemyName+' Lv.'+enemy.level;
 renderHeroName(hero);
 $('enemyStats').innerHTML=rowUnit(enemy);
 $('heroStats').innerHTML=rowUnit(hero);
 $('battleSpells').innerHTML=run.slotIds.map((id,i)=>{
  const c=circles.find(x=>x.id===id),s=hero.spells[i],waiting=hero.cooldowns[i]||0;
  // Empty slots must not look castable; a missing saved photo is an explicit error.
  if(!id)return '<div class="battle-spell-frame"><div class="loadout-tile battle-tile battle-spell-tile empty" aria-label="魔法陣の編成枠 '+(i+1)+' 未装備">'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<span class="tile-empty-icon" aria-hidden="true">＋</span><span class="tile-title">未装備</span></div></div>';
  if(!c?.image)return '<div class="battle-spell-frame"><div class="loadout-tile battle-tile battle-spell-tile unavailable" aria-label="魔法陣の編成枠 '+(i+1)+' 画像が見つかりません">'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<span class="tile-empty-icon" aria-hidden="true">！</span><span class="tile-title">画像なし</span></div></div>';
  const disabled=Boolean(s&&!G.canCast(hero,i));
  return '<div class="battle-spell-frame"><button type="button" class="loadout-tile battle-tile battle-spell-tile '+(disabled?'unavailable':'equipped')+'" data-cast="'+i+'" aria-label="魔法陣の編成枠 '+(i+1)+' '+(c.analysis?circleLabel(c.analysis,isRevealed(c)):'未解析')+'" '+(disabled?'disabled':'')+'>'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<img alt="" src="'+battleImageUrl(c.image)+'">'
    +'<span class="tile-cooldown">'+(waiting?'待機 '+waiting:'発動')+'</span></button>'
    +circleEffectBadges(c,masters.buffs,esc,G.mpCost)
    +'<button type="button" class="subtle magic-expand" data-circle-detail="'+esc(c.id)+'">詳細</button></div>';
 }).join('');
 $('battleBasic').innerHTML='<button type="button" class="subtle basic-attack" data-cast="-1">⚔️通常攻撃</button>';
 // Match the prepared-item capacity, but keep extra occupied legacy slots visible.
 const maxSlots=Math.max(G.capacity(profile.level),run.carry.findLastIndex(Boolean)+1);
 $('battleItems').innerHTML=Array.from({length:maxSlots},(_,i)=>{
  const item=run.carry[i],noEffect=Boolean(item&&!G.canUseBattleItem(hero,item,masters.items,masters.buffs));
  const disabled=noEffect;
  if(!item)return '<button type="button" class="loadout-tile battle-tile battle-item-tile empty" disabled aria-label="アイテム空き枠 '+(i+1)+'"><span class="tile-index">'+String(i+1).padStart(2,'0')+'</span><span class="tile-empty-icon" aria-hidden="true">＋</span><span class="tile-title">空き</span></button>';
  return '<button type="button" class="loadout-tile battle-tile battle-item-tile equipped'+(noEffect?' no-effect':'')+'" data-use="'+i+'" '+(disabled?'disabled':'')+' aria-label="'+esc(itemName(item))+'・'+esc(itemEffectText(item))+(noEffect?'・現在は効果なし':'')+'">'
   +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
   +'<span class="tile-item-icon" aria-hidden="true">'+itemSymbol(item)+'</span>'
   +'<span class="tile-title">'+esc(itemName(item))+'</span>'
   +'<span class="tile-item-effect item-effect-icons" aria-hidden="true">'+itemEffectIcons(item)+(item.bonus?' ✦':'')+'</span></button>';
 }).join('');
 $('battleInfo').innerHTML=rewardLedgerMarkup(run)
  +(hero.reviveArmed?'<div class="battle-revival">🪽 生命の紅石 · 復活待機中</div>':hero.reviveUsed?'<div class="battle-revival">🪽 生命の紅石 · 発動済み</div>':'');
 $('battleLog').innerHTML=run.log.slice(-15).map(x=>'<p>'+esc(roleText(x))+'</p>').join('');
}
function clearCombatEffects(){
 $('battleArena').dataset.shake='false';
 for(const side of ['hero','enemy']){
  const target=$(side+'Combatant');
  target.dataset.effect='idle';
  target.dataset.hit='false';
   target.dataset.incoming='none';
  $(side+'Projectile').dataset.effect='idle';
  $(side+'FxText').textContent='';
 }
}
async function animateBattle(steps){
 if(!steps.length)return;
 playingEffects=true;
 $('battleSpells').setAttribute('aria-busy','true');
 $('battleItems').setAttribute('aria-busy','true');
 try{
  await playCombatSequence(steps,phase=>{
   clearCombatEffects();
   // Force a new CSS animation cycle even after consecutive turns with the same role.
   void $('battleArena').offsetWidth;
   $('battleArena').dataset.shake=phase.some(step=>['attack','basic'].includes(step.role)&&step.amount>0)?'true':'false';
   for(const step of phase){
    const actor=$(step.side+'Combatant');
    actor.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
    actor.dataset.effect=step.role;
    // Magic attacks travel across the arena from their caster to their target.
    // Each simultaneous fighter controls a separate projectile.
    if(step.role==='attack'){
     const projectile=$(step.side+'Projectile');
     projectile.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
     projectile.dataset.effect='attack';
    }
    $(step.side+'FxText').textContent=effectCaption(step);
   }
   for(const step of phase){
    if(!['attack','basic','debuff'].includes(step.role))continue;
    const opponent=step.side==='hero'?'enemy':'hero';
    const victim=$(opponent+'Combatant');
    victim.dataset.hit='true';
     victim.dataset.incoming=step.role;
    if(victim.dataset.effect==='idle')victim.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
   }
   const final=phase.at(-1);
   renderHeroName(final.hero);
    $('heroStats').innerHTML=rowUnit(final.hero);
   $('enemyStats').innerHTML=rowUnit(final.enemy);
  },{overlap:125,onFatal:side=>ceremony(side==='hero'?'hero-death':'enemy-death',
   side==='hero'?'探索失敗':'討伐成功',
   side==='hero'?(profile.name||'冒険者'):(profile.run?.enemyName||''))});
 }finally{
  clearCombatEffects();
  $('battleSpells').removeAttribute('aria-busy');
  $('battleItems').removeAttribute('aria-busy');
  playingEffects=false;
 }
}
async function ceremony(event,title,detail='',drops=0){
 playingEffects=true;
 const stage=$('battleCeremony');
 const entering=event==='encounter';
 const run=profile.run;
 const tier=(entering||event==='enemy-death')?bossCeremonyTier(run?.floor):'none';
 const layer=Math.ceil((run?.floor||0)/5);
 const arena=$('battleArena');
 arena.dataset.bossCeremony=tier;
 arena.dataset.ceremonyEvent=event;
 stage.dataset.bossTier=tier;
 if(tier!=='none'){
  if(entering){
   title=tier==='final'?'FINAL BOSS':tier==='milestone'?'強敵出現':'階層ボス出現';
   detail=layer+'層 · '+(run?.enemyName||'')+' が現れた';
  }else{
   title=tier==='final'?'100層 完全制覇':tier==='milestone'?'強敵撃破':'階層ボス撃破';
   detail=layer+'層 · '+(run?.enemyName||'')+' を討伐';
  }
 }
 if(entering){
  // Enemy data is already rendered; reveal the fresh opponent only when
  // the new encounter animation actually begins.
  $('enemyCombatant').dataset.defeated='false';
  $('enemyCombatant').dataset.entering='true';
 }
 const side=event==='hero-death'?'hero':event==='enemy-death'?'enemy':null;
 const duration=ceremonyDuration(event,run?.floor,{animated:effectDuration()>0,drops});
 stage.dataset.event=event;
 stage.setAttribute('style','--ceremony-duration:'+(duration/1000)+'s');
 $('ceremonyTitle').textContent=title;
 $('ceremonyDetail').textContent=detail;
 $('lootChests').innerHTML=event==='loot'?treasureChestMarkup(drops):'';
 if(side)$(side+'Combatant').dataset.dying='true';
 try{
  await playBattleCeremony(event,()=>{stage.hidden=false;},{duration});
 }finally{
  // Keep the defeated enemy's overlay mounted until loot takes over.
  // Hiding it here briefly exposed a neutral battle frame between ceremonies.
  if(event!=='enemy-death'){
   stage.hidden=true;
   stage.dataset.event='idle';
  }
  if(entering)$('enemyCombatant').dataset.entering='false';
  arena.dataset.bossCeremony='none';
  arena.dataset.ceremonyEvent='idle';
  if(event==='enemy-death')$('enemyCombatant').dataset.defeated='true';
  if(side)$(side+'Combatant').dataset.dying='false';
  if(event!=='enemy-death')$('lootChests').innerHTML='';
  playingEffects=false;
 }
}
function createEnemy(fight,run){
 const spec=floorMaster(fight),level=Number(spec.enemy_level),layer=layerForFight(fight);
 if(Number(spec.boss)!==Number(isLayerBoss(fight)))throw Error('階層ボスの配置が不正');
 let row;
 if(layer<=100&&!isLayerBoss(fight)){
  const slot=(fight-1)%FIGHTS_PER_LAYER;
  if(run.layerEnemyOrder?.layer!==layer||!Array.isArray(run.layerEnemyOrder.ids)||run.layerEnemyOrder.ids.length!==4)
   run.layerEnemyOrder={layer,ids:shuffledLayerEnemyIds(masters.enemies,layer,Math.random,slot)};
  row=masters.enemies.find(enemy=>enemy.id===run.layerEnemyOrder.ids[slot]);
  if(!row||row.boss_only==='1')throw Error('階層の敵順が不正');
 }else row=enemyForFight(masters.enemies,fight);
 if(Number(row.min_level)>level||(isLayerBoss(fight)&&row.boss_only!=='1'))throw Error('敵の設定が不正');
 if(spec.boss_enemy_id&&row.id!==spec.boss_enemy_id)throw Error('ボスの設定が不正');
 return {unit:G.fromEnemy(row,level),name:row.name};
}
function enterFight(){const run=profile.run,{unit,name}=createEnemy(run.floor,run);
 run.hero.reviveArmed=false;run.hero.reviveUsed=false;
 // Keep the previous defeated opponent hidden while the next opponent is prepared.
 // The encounter ceremony reveals the replacement after renderRun().
 run.enemy=unit;run.enemyName=name;run.stage='battle';run.log.push(encounterLabel(run.floor)+(isLayerBoss(run.floor)?'・階層ボス':'')+'：'+name+'が現れた');}
function narrativeLines(id,lines){$(id).textContent=lines.join('\n');}
function renderCheckpoint(){
 const run=profile.run;if(!run)return;
 const layer=clearedLayer(run.floor);
 narrativeLines('checkpointInfo',[
  layer+'層の階層ボスを撃破！',
  layer+'層踏破。',
  ...(run.loot.some(item=>item.type==='rank'&&item.layer===layer)?[rankBadgeName(layer)+'を発見！ 帰還で獲得が確定。']:[])
 ]);
 $('checkpointLedger').innerHTML=rewardLedgerMarkup(run);
 $('deeper').textContent=(layer+1)+'層へ進む';
const pending=isBonusLayer(layer)&&!run.bonusClaimed;
if($('bonusChoices'))$('bonusChoices').hidden=!pending;
$('deeper').disabled=pending;
$('returnHome').disabled=pending;
}
async function claimBonus(choice){
 const run=profile.run;
 if(!run||run.stage!=='checkpoint'||run.bonusClaimed||!isBonusLayer(clearedLayer(run.floor)))return;
 const layer=clearedLayer(run.floor);
 if(choice==='restore'){run.hero.hp=run.hero.stats.hp;run.hero.mp=run.hero.maxMp;}
 else if(choice==='collection'){const item=bonusCollection(masters.collections,layer);run.loot.push({type:'collection',id:item.id});}
 else if(choice==='item'){
  const row=bonusConsumable(masters.items,layer);
  const item={type:'use',id:row.id,value:G.rollPotionValue(row,layer),bonus:row.bonus_buff_id&&Math.random()<Number(row.bonus_chance)?row.bonus_buff_id:null};
  const free=run.carry.findIndex(x=>!x);
  if(free>=0)run.carry[free]={...item,returnBonus:true};else run.loot.push(item);
 }else return;
 run.bonusClaimed=true;await persist();renderCheckpoint();renderRun();show('checkpoint');
}
async function begin(){if(profile.run||!canDepartWithCircles(slots)){note('魔法陣を3〜5個編成してください');return;}
 const startLayer=allowedStartLayer(profile,selectedStartLayer);
 photoAnalysisEpoch++;const selectedIndices=pickedValues(carry);profile.carrySlots=saveCarrySlots(carry,profile.inventory);const selected=carry.map(i=>Number.isInteger(i)?profile.inventory[i]:null);for(const i of [...selectedIndices].sort((a,b)=>b-a))profile.inventory.splice(i,1);const hero=G.makeUnit(profile.base,profile.level,{},slots.map(id=>{const a=circles.find(c=>c.id===id)?.analysis;return a?{...a}:null;}),'player');profile.slots=[...slots];profile.run={floor:(startLayer-1)*FIGHTS_PER_LAYER+1,slotIds:[...slots],hero,enemy:null,carry:selected,loot:[],xp:0,log:[],stage:'battle'};profile.attempts++;enterFight();carry=prepareItems([],profile.inventory.length,G.capacity(profile.level));await persist();renderRun();show('battle');scrollToDungeonTabs();await ceremony('encounter','ENCOUNTER',profile.run.enemyName+' が現れた');}
function enemyChoice(enemy){const ids=G.available(enemy);if(!ids.length)return -1;const heal=ids.find(i=>enemy.spells[i].role==='support');if(enemy.hp<enemy.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;const offense=ids.filter(i=>enemy.spells[i].role==='attack');return offense.length&&Math.random()<num('enemy_attack_preference')?offense[Math.floor(Math.random()*offense.length)]:ids[Math.floor(Math.random()*ids.length)];}
async function takeTurn(index){
 const run=profile.run;if(playingEffects||!run||run.stage!=='battle')return;
 if(index>=0&&!run.slotIds[index])return;
 const circle=index>=0?circles.find(c=>c.id===run.slotIds[index]):null;
 if(circle?.analysis&&!run.hero.spells[index])run.hero.spells[index]={...circle.analysis};
 const spell=index>=0?run.hero.spells[index]:null;
 if(index!==-1&&!spell){await analyzeUnknown(index);return;}if(index!==-1&&!G.canCast(run.hero,index)){note('MP不足・再使用待ち・封印のため使用できない');return;}const steps=[];try{run.log.push(...G.round(run.hero,run.enemy,index,enemyChoice(run.enemy),masters.buffs,Math.random,step=>steps.push(step)));}catch(e){note(e.message);return;}
 if(circle?.analysis&&!isRevealed(circle)){Object.assign(circle,revealOnUse(circle));await putCircle(db,circle);}
 await animateBattle(steps);
if(run.hero.hp<=0){const dropped=run.loot.length,unusedCount=run.carry.filter(Boolean).length;profile.inventory.push(...run.carry.filter(Boolean));profile.run=null;selectedStartLayer=null;ensureItemInstances(profile);profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));carry=restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));await persist();$('resultTitle').textContent='探索失敗';narrativeLines('resultText',[
 '未確定報酬 '+dropped+'個と経験値を喪失。',
 '未使用の携行品 '+unusedCount+'個は倉庫へ戻った。',
 '性能が判明した魔法陣は残る。'
]);show('result');return;}
if(run.enemy.hp<=0){const bossEnemyId=isLayerBoss(run.floor)?run.enemy.id:null;
  const firstBossDefeat=Boolean(bossEnemyId&&!profile.defeatedBosses?.[bossEnemyId]);
  const rewards=G.drops(masters.items,masters.collections,run.enemy.level,Math.random,{layer:layerForFight(run.floor),bossEnemyId,guaranteeBossCollection:firstBossDefeat});
  if(bossEnemyId){profile.defeatedBosses??={};profile.defeatedBosses[bossEnemyId]=true;}
  const badge=rankBadgeDrop(run.floor,run.hero,profile,run.loot);
  if(badge)rewards.push(badge);
  run.loot.push(...rewards);run.xp+=G.fightExperience(run.enemy.level,run.hero.level,layerForFight(run.floor));run.log.push(rewards.length?'撃破！ '+rewards.length+'個を入手（未確定）':'撃破！ 今回の戦利品はなし');await ceremony('loot',rewards.length?'戦利品の発見':'戦利品なし',rewards.length?rewards.length+'個 · 未確定':'次の戦いへ',rewards.length);run.hero.statuses=[];run.hero.cooldowns=run.hero.cooldowns.map(()=>0);G.recoverVictoryMp(run.hero);if(isLayerBoss(run.floor)){run.checkpointBattleScrollY=window.scrollY??window.pageYOffset??0;run.stage='checkpoint';renderCheckpoint();show('checkpoint');await persist();return;}run.floor++;enterFight();renderRun();
// Start the next enemy immediately; IndexedDB writes used to leave a neutral frame
// between the loot overlay and the following encounter animation.
const nextEntrance=ceremony('encounter','ENCOUNTER',run.enemyName+' が現れた');await persist();await nextEntrance;}
await persist();renderRun();}
async function useItem(index){
 const run=profile.run;if(playingEffects||!run||run.stage!=='battle')return;
 const item=run.carry[index];if(!item||!G.canUseBattleItem(run.hero,item,masters.items,masters.buffs))return;
 try{
  const row=masters.items.find(x=>x.id===item.id);
  if(row?.kind==='escape'){
   run.carry[index]=null;
   run.log.push(itemName(item)+'を使用して脱出');
   await leave('escape');
   return;
  }
  if(row?.kind==='revive'&&(run.hero.reviveArmed||run.hero.reviveUsed)){
   note('生命の紅石はこの戦闘ですでに使用済みです');return;
  }
  const n=G.potion(run.hero,item,masters.items,masters.buffs);
  run.carry[index]=null;
  run.log.push(itemName(item)+(row?.kind==='revive'?'を使用・復活待機中':'を使用 '+(n?'('+n+')':'')));
  const snapshot=u=>({...u,statuses:u.statuses.map(s=>({...s})),cooldowns:[...u.cooldowns]});
  const step=(role,amount)=>({role,side:'hero',attribute:row?.attribute||'law',amount,hero:snapshot(run.hero),enemy:snapshot(run.enemy)});
  await animateBattle([step('item',n),...(item.bonus?[step('buff',0)]:[])]);
  await persist();renderRun();
 }catch(e){note(e.message);}
}
function paintReturnXp(elapsed){
 if(!returnFlow)return;
 const frame=returnXpFrame(returnFlow.before,returnFlow.gained,elapsed,G.nextXp,num('level_max'));
 const label=$('returnLevel'),next='Lv.'+frame.level;
 if(label.textContent!==next){
  const levelUp=label.textContent!==''&&frame.level>Number(label.textContent.replace('Lv.',''));
  label.textContent=next;
  label.className='return-xp-level';
  if(levelUp){void label.offsetWidth;label.className='return-xp-level return-xp-level-up';}
 }
 $('returnXpFill').setAttribute('style','width:'+frame.percent+'%');
 $('returnXpTrack').setAttribute('aria-valuenow',String(Math.round(frame.percent)));
}
function renderReturnStep(){
 if(!returnFlow)return;
 ++returnAnimationToken;
 const kind=returnFlow.steps[returnFlow.step];
 $('returnCollections').hidden=kind!=='collections';
 $('returnRewards').hidden=kind!=='rewards';
 $('returnExperience').hidden=kind!=='xp';
 $('returnSceneTitle').textContent={collections:'コレクション報酬',rewards:'アイテム報酬',xp:'EXP'}[kind];
 $('returnNext').textContent=returnFlow.step===returnFlow.steps.length-1?'完了':'次へ';
 $('returnNext').disabled=false;
 if(kind==='collections'){
  $('returnCollections').innerHTML=returnFlow.collections.map(({id,count,isNew},i)=>{
   const index=masters.collections.findIndex(row=>row.id===id),row=masters.collections[index];
   if(!row)return '';
   return '<article class="return-treasure" data-rarity="'+esc(row.rarity)+'" style="--reveal-delay:'+(Math.min(i,12)*.07)+'s">'
    +(isNew?'<span class="return-new">NEW</span>':'')
    +'<div class="return-treasure-art" aria-hidden="true">'+relicSymbolSvg(index,true)+'</div>'
    +'<strong>'+esc(row.name)+'</strong>'+(count>1?'<span class="return-count">×'+count+'</span>':'')+'</article>';
  }).join('');
 }else if(kind==='rewards'){
  $('returnRewards').innerHTML=returnFlow.rewards.map((reward,i)=>{
   let symbol,name,count=reward.count;
   if(reward.type==='use'){symbol=itemSymbol(reward.item);name=itemName(reward.item);}
   else if(reward.type==='stone'){symbol='✦';name='魔導石';}
   else{symbol='✧';name=reward.name;}
   return '<article class="return-reward" style="--reveal-delay:'+(Math.min(i,12)*.07)+'s">'
    +(reward.isNew||reward.type==='rank'||reward.type==='stone'?'<span class="return-new">NEW</span>':'')
    +'<span class="return-reward-symbol" aria-hidden="true">'+symbol+'</span>'
    +'<strong>'+esc(name)+'</strong>'
    +(reward.type==='use'?'<span class="return-reward-effect" aria-label="'+esc(itemEffectText(reward.item))+'">'+itemEffectIcons(reward.item)+(reward.item.bonus?' ✦':'')+'</span>':'')
    +(count>1?'<span class="return-count">×'+count+'</span>':'')+'</article>';
  }).join('');
 }else{
  $('returnLevel').textContent='';
  $('returnXpGain').textContent='+'+returnFlow.gained+' EXP';
  paintReturnXp(0);
  const reduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced||typeof requestAnimationFrame!=='function'){
   paintReturnXp(RETURN_XP_DURATION_MS);
   return;
  }
  $('returnNext').disabled=true;
  const token=returnAnimationToken;
  let started=null;
  const tick=timestamp=>{
   if(token!==returnAnimationToken||!returnFlow||activeScene!=='returnShowcase')return;
   if(started===null)started=timestamp;
   const elapsed=Math.min(RETURN_XP_DURATION_MS,Math.max(0,timestamp-started));
   paintReturnXp(elapsed);
   if(elapsed<RETURN_XP_DURATION_MS)requestAnimationFrame(tick);
   else $('returnNext').disabled=false;
  };
  requestAnimationFrame(tick);
 }
}
let shareImageFile=null,shareImageGeneration=0;
function showSupportPrompt(prompt,mode='milestone'){
 if(!prompt||activeScene!=='home')return;
 const generation=++shareImageGeneration;
 shareImageFile=null;
 const data=adventurerShareData(profile),canvas=$('adventurerShareCanvas');
 $('supportPromptTitle').textContent=prompt.title;
 $('supportPromptMessage').textContent=prompt.message;
 $('supportOptionalNote').hidden=mode==='share';
 $('supportXLink').href=adventurerXUrl(data);
 $('supportShareHelp').textContent='Xの投稿には本文が入ります。画像は保存して添付できます。';
 $('supportNativeShare').hidden=true;
 $('supportSaveImage').disabled=false;
 try{
  paintAdventurerCard(canvas,data);
  canvas.hidden=false;
  if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&typeof File!=='undefined'){
   canvas.toBlob(blob=>{
    if(generation!==shareImageGeneration||!blob)return;
    try{
     const file=new File([blob],'magia-adventurer-card.png',{type:'image/png'});
     if(navigator.canShare({files:[file]})){
      shareImageFile=file;
      $('supportNativeShare').hidden=false;
     }
    }catch(error){console.warn('画像共有には対応していません',error);}
   },'image/png');
  }
 }catch(error){
  console.warn('冒険者カードの生成に失敗',error);
  canvas.hidden=true;
  $('supportSaveImage').disabled=true;
  $('supportShareHelp').textContent='画像を生成できませんでした。Xには本文のみ共有できます。';
 }
 $('supportPromptDialog').showModal();
}
function openAdventurerShare(){
 showSupportPrompt({title:'冒険者カード',message:'冒険者等級・レベル・最深帰還をシェア'},'share');
}
function downloadAdventurerCard(){
 const canvas=$('adventurerShareCanvas');
 if(canvas.hidden)return;
 try{
  const anchor=document.createElement('a');
  anchor.href=canvas.toDataURL('image/png');
  anchor.download='magia-adventurer-card.png';
  anchor.click();
 }catch(error){
  $('supportShareHelp').textContent='画像を保存できませんでした。別のブラウザでお試しください。';
 }
}
async function shareAdventurerCardImage(){
 if(!shareImageFile||typeof navigator.share!=='function')return;
 try{
  await navigator.share({files:[shareImageFile],title:'冒険者カード',
   text:adventurerShareText(adventurerShareData(profile))+'\n'+DUNGEON_SHARE_URL});
 }catch(error){
  if(error?.name!=='AbortError')$('supportShareHelp').textContent='画像を共有できませんでした。保存して添付してください。';
 }
}
async function advanceReturnStep(){
 if(!returnFlow||$('returnNext').disabled)return;
 if(++returnFlow.step<returnFlow.steps.length){
  await persist();
  renderReturnStep();
  return;
 }
 ++returnAnimationToken;
 const supportPrompt=returnFlow.supportPrompt||null;
 profile.pendingReturn=null;
 await persist();
 returnFlow=null;
 show('home');
 showSupportPrompt(supportPrompt);
}
async function leave(mode='checkpoint'){
 const run=profile.run;
 if(!run||(mode==='escape'?run.stage!=='battle':run.stage!=='checkpoint'))return;
 const found=new Map(),items=new Map(),badges=[];
 const knownItems=new Set(profile.obtainedItemIds);
 let stones=0;
 const registerItem=item=>{
  const key=JSON.stringify([item.id,item.value,item.bonus]);
  const existing=items.get(key);
  if(existing)existing.count++;
  else items.set(key,{type:'use',item,count:1,isNew:!knownItems.has(item.id)});
 };
 // A checkpoint bonus enters the carry slots directly, not the loot ledger.
 for(const item of run.carry.filter(item=>item?.returnBonus))registerItem(item);
 profile.inventory.push(...run.carry.filter(Boolean).map(item=>{
  if(!item.returnBonus)return item;
  const {returnBonus,...saved}=item;
  return saved;
 }));
 for(const item of run.loot){
  if(item.type==='use'){
   profile.inventory.push(item);
   registerItem(item);
  }else if(item.type==='stone'){
   profile.magicStones++;
   stones++;
  }else if(item.type==='collection'){
   const oldCount=Number(profile.collection[item.id]||0);
   profile.collection[item.id]=oldCount+1;
   const existing=found.get(item.id);
   if(existing)existing.count++;
   else found.set(item.id,{id:item.id,count:1,isNew:oldCount===0});
  }else if(item.type==='rank'&&acquireAdventurerRank(profile,item.layer)){
   badges.push({type:'rank',name:rankBadgeName(item.layer),count:1});
  }
 }
 const before={level:profile.level,xp:profile.xp};
 G.experience(profile,run.xp);
 const previousDepth=deepestReturnedLayer(profile);
 recordReturnedLayer(profile,mode==='escape'?Math.floor((run.floor-1)/FIGHTS_PER_LAYER)*FIGHTS_PER_LAYER:run.floor);
 const supportPrompt=supportPromptForReturn(previousDepth,deepestReturnedLayer(profile),badges.length?highestRankLayer(profile):0);
 profile.returns++;
 profile.obtainedItemIds=[...new Set([...knownItems,...[...items.values()].map(({item})=>item.id)])];
 profile.run=null;
 selectedStartLayer=null;
 ensureItemInstances(profile);
 profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 carry=restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 const rewards=[...badges,...(stones?[{type:'stone',count:stones}]:[]),...[...items.values()].sort((a,b)=>Number(b.isNew)-Number(a.isNew))];
 const steps=[...(found.size?['collections']:[]),...(rewards.length?['rewards']:[]),...(run.xp>0?['xp']:[])];
 if(!steps.length){
  profile.pendingReturn=null;
  await persist();
  render();
  show('home');
  showSupportPrompt(supportPrompt);
  return;
 }
 returnFlow={steps,step:0,collections:[...found.values()].sort((a,b)=>Number(b.isNew)-Number(a.isNew)),rewards,before,gained:run.xp,supportPrompt};
 profile.pendingReturn=returnFlow;
 await persist();
 render();
 renderReturnStep();
 show('returnShowcase');
}
async function waitUntil(check,valid,maxMs=150000){const end=Date.now()+maxMs;while(Date.now()<end){if(!valid())throw Error('解析が中断されました');const value=check();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('解析が完了しませんでした。カメラと通信環境を確認してください');}
async function parseCircleImage(circle,frame,valid,request=null){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,result)=>{
   if(settled)return;
   settled=true;frame.onload=null;frame.src='about:blank';
   if(error)reject(error);else resolve(result);
  };
  if(request)request.cancel=()=>finish(Error('解析が中断されました'));
  frame.onload=async()=>{
   try{
    const doc=frame.contentDocument;
    const input=await waitUntil(()=>{const el=doc?.getElementById('fileInput');return el&&!el.disabled?el:null;},valid);
    const transfer=new DataTransfer();
    transfer.items.add(new File([circle.image],'circle.jpg',{type:circle.image.type||'image/jpeg'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const analyze=await waitUntil(()=>{const el=doc?.getElementById('analyzeButton');return el&&!el.disabled?el:null;},valid);
    analyze.click();
    await waitUntil(()=>!doc.getElementById('altarSection')?.hidden,valid);
    finish(null,normalizeAnalysisResult({
     attribute:doc.querySelector('#attributeResult .altar-value')?.textContent?.trim(),
     role:doc.querySelector('#shapeResult .altar-value')?.textContent?.trim(),
     power:doc.querySelector('#powerResult .altar-value')?.textContent?.trim()
    }));
   }catch(e){finish(e);}
  };
  frame.src='magia-circle.html';
 });
}
async function analyzeCapturedCircle(circle){
 // Reveal the real analyzer for each photo. The live camera remains active
 // in the grimoire, so another photo can be taken immediately after returning.
 const request={id:circle.id,type:'capture',epoch:photoAnalysisEpoch};
 activeAnalysis=request;
 rememberCameraScroll();
 show('analyzing');
 note('');
 const valid=()=>activeAnalysis===request&&!profile.run&&request.epoch===photoAnalysisEpoch;
 try{
  const result=await parseCircleImage(circle,$('analyzerFrame'),valid,request);
  if(!valid())return;
  const analyzed=savePreanalysis(circle,result);
  // No record is written until all analysis values have been validated.
  await putCircle(db,analyzed);
  if(!valid())return;
  circles=newestCirclesFirst([...circles,analyzed]);
  activeAnalysis=null;
  show('library');
  returnToCameraScroll();
 }catch(e){
  if(!valid())return;
  activeAnalysis=null;
  show('library');
  returnToCameraScroll();
  $('cameraError').textContent='魔法陣を解明できませんでした。写真は保存していません。もう一度撮影してください。';
  $('cameraError').hidden=false;
 }
}
async function analyzeUnknown(index){
 const run=profile.run,circle=circles.find(x=>x.id===run?.slotIds[index]);
 if(!circle){note('魔法陣が見つからない');return;}
 const request={id:circle.id,index};
 activeAnalysis=request;show('analyzing');note('');
 const valid=()=>activeAnalysis===request&&profile.run===run;
 (async()=>{
  try{
   const analysis=await parseCircleImage(circle,$('analyzerFrame'),valid,request);
   if(!valid())return;
   Object.assign(circle,savePreanalysis(circle,analysis));
   await putCircle(db,circle);
   if(!valid())return;
   run.hero.spells[index]={...analysis};await persist();
   activeAnalysis=null;note('');show('battle');await takeTurn(index);
  }catch(e){
   if(!valid())return;
   activeAnalysis=null;note('解明できませんでした：'+e.message);
   renderRun();show('battle');
  }
 })();
}
function syncCameraUi(active){
 $('cameraPlaceholder').hidden=active;
 $('cameraVideo').hidden=!active;
 $('cameraStart').hidden=active;
 $('cameraCapture').hidden=!active;
 $('cameraStop').hidden=!active;
}
async function startCamera(){
 if(stream){syncCameraUi(true);return;}
 if(!navigator.mediaDevices?.getUserMedia){note('HTTPSまたはlocalhostのカメラ対応ブラウザが必要です。');return;}
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
  $('cameraVideo').srcObject=stream;
  $('cameraVideo').hidden=false;
  await $('cameraVideo').play();
  syncCameraUi(true);note('');
 }catch(e){stopCamera();note('カメラを起動できません：'+e.message);}
}
function stopCamera(){
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 $('cameraVideo').srcObject=null;syncCameraUi(false);
}
async function capture(){
 if(!stream||!$('cameraVideo').videoWidth)return;
 const v=$('cameraVideo'),canvas=$('cameraCanvas'),side=Math.min(v.videoWidth,v.videoHeight),max=1280,scale=Math.min(1,max/side);
 canvas.width=Math.round(side*scale);canvas.height=canvas.width;
 canvas.getContext('2d').drawImage(v,(v.videoWidth-side)/2,(v.videoHeight-side)/2,side,side,0,0,canvas.width,canvas.height);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
 if(!blob){note('撮影画像を作成できません');return;}
 lastCaptureRegistration=Math.max(nextCircleRegistration(circles),lastCaptureRegistration+1);
 const circle=newCapturedCircle(crypto.randomUUID(),blob,lastCaptureRegistration);
 // Do not save until the analysis succeeded. Photo stays in memory while queued.
 $('cameraError').hidden=true;$('cameraError').textContent='';
 await analyzeCapturedCircle(circle);
}
function oneSentencePerLine(value){return String(value).replace(/([。！？])\s*(?=\S)/gu,'$1\n');}
function openMagicDetails(id){
 const circle=circles.find(c=>c.id===id);if(!circle)return;
 $('magicDetailsDialog').dataset.circleId=id;
 $('upgradeFeedback').textContent='';
 $('magicStoneStock').textContent='所持魔導石：'+profile.magicStones+'個 / 強化1回につき1個';
 $('upgradeCircle').hidden=Boolean(profile.run);
 $('upgradeCircle').disabled=Boolean(profile.run)||!isRevealed(circle)||profile.magicStones<1;
 $('upgradeHint').textContent=!isRevealed(circle)?'威力は初回使用後に強化できます。':profile.magicStones<1?'魔導石を入手すると強化できます。':'初期威力の10%分ずつ、何度でも強化できます。';
 const d=circleDetails(circle,masters.buffs,G.mpCost);
 $('magicDetailsImage').src=imageUrl(circle.image);
 const info=circleEffectDetails(circle,masters.buffs);
 const rows=[['属性',d.attribute],['種別',d.role],['効果の詳細',info.effect]];
 if(info.statusName)rows.push(['追加効果名',info.statusName],['追加効果の詳細',info.statusDescription],['持続時間',info.duration]);
 rows.push(['MP',d.mp],['威力',d.power]);
 if(isRevealed(circle)&&circle.upgradeLevel)rows.push(['強化', '+'+(circle.upgradeLevel*10)+'%']);
 $('magicDetailsStats').innerHTML=rows.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(oneSentencePerLine(value))+'</dd>').join('');
 if(!$('magicDetailsDialog').open)$('magicDetailsDialog').showModal();
}
function askCircleAction(type,id){
 if(profile.run)return;
 const circle=circles.find(c=>c.id===id);
 if(!circle)return;
 if(type==='upgrade'&&(!isRevealed(circle)||profile.magicStones<1))return;
 pendingCircleAction={type,id};
 $('circleActionTitle').textContent=type==='upgrade'?'魔法陣を強化しますか？':'魔法陣を削除しますか？';
 $('circleActionMessage').textContent=type==='upgrade'
  ?'魔導石を1個消費して威力を初期値の10%分アップします。\nこの強化は元に戻せません。'
  :'登録した魔法陣は元に戻せません。\n削除してもよろしいですか？';
 $('confirmCircleAction').textContent=type==='upgrade'?'魔導石を使って強化':'削除する';
 if(!$('circleActionDialog').open)$('circleActionDialog').showModal();
}
async function confirmCircleAction(){
 const action=pendingCircleAction;
 if(!action||profile.run)return;
 const circle=circles.find(c=>c.id===action.id);
 if(!circle){$('circleActionDialog').close();pendingCircleAction=null;return;}
 try{
  if(action.type==='upgrade'){
   if(!isRevealed(circle)||profile.magicStones<1)return;
   const enhanced=upgradeCircle(circle);
   // Persist only scalar metadata: rewriting a stored photo Blob can fail on mobile browsers.
   const nextProfile={...profile,magicStones:profile.magicStones-1,
    circleUpgrades:{...(profile.circleUpgrades||{}),[circle.id]:savedUpgrade(enhanced)}};
   await saveProfile(db,nextProfile);
   profile=nextProfile;
   Object.assign(circle,enhanced);
   render();
   openMagicDetails(circle.id);
   $('upgradeFeedback').textContent='✦ 強化成功！\n威力 '+enhanced.analysis.power+' ✦';
   const dialog=$('magicDetailsDialog');
   dialog.dataset.enhancing='false';
   void dialog.offsetWidth;
   dialog.dataset.enhancing='true';
  }else if(action.type==='remove'){
   await deleteCircle(db,circle.id);
   if(profile.circleUpgrades){
    const upgrades={...profile.circleUpgrades};
    delete upgrades[circle.id];
    profile.circleUpgrades=upgrades;
   }
   circleImages.release(circle.image);
   circles=circles.filter(c=>c.id!==circle.id);
   slots=slots.map(id=>id===circle.id?null:id);
   profile.slots=[...slots];
   await persist();render();
  }
  $('circleActionDialog').close();
  pendingCircleAction=null;
 }catch(e){note('魔法陣の処理に失敗しました：'+e.message);}
}
function renderLoadoutChoices(){
 if(!picker)return;
 if(picker.kind==='circle'){
  const filter=pickerView.circle.filter;
  const role=['attack','defense','support','debuff'].includes(filter)?filter:'all';
  const attribute=G.ATTRS.includes(filter)?filter:'all';
  const indexes=circleListIndexes(circles,{role,attribute,sort:pickerView.circle.sort});
  $('loadoutOptions').innerHTML=indexes.length?circleChoices(circles,slots,imageUrl,esc,null,masters.buffs,G.mpCost,indexes,picker.index)
   :'<p class="collection-empty">条件に合う魔法陣はありません。</p>';
 }else{
  const indexes=itemListIndexes(profile.inventory,masters.items,{kind:pickerView.item.filter,sort:pickerView.item.sort});
  $('loadoutOptions').innerHTML=indexes.length?itemChoices(profile.inventory,carry,itemName,esc,indexes,picker.index)
   :'<p class="collection-empty">条件に合うアイテムはありません。</p>';
 }
}
function openLoadoutPicker(kind,index){
 if(profile.run)return;
 if(kind==='circle'){
  if(index<0||index>=slots.length)return;
 }else{
  if(profile.returns===0||index<0||index>=G.capacity(profile.level))return;
 }
 picker={kind,index};
 const dialog=$('loadoutDialog');
 $('loadoutDialogTitle').textContent=kind==='circle'?'魔法陣を選ぶ':'携行品を選ぶ';
 const filters=kind==='circle'
  ?[['all','すべて'],['attack','⚔️攻撃'],['defense','🛡️防御'],['support','✚回復'],['debuff','🕸️弱体'],
    ['flame','🔥炎'],['bolt','⚡雷'],['aqua','💧水'],['storm','🌪️風'],['gravity','🪨重力'],['law','⚖️秩序'],['chaos','🌀混沌']]
  :[['all','すべて'],['heal','HP回復'],['mana','MP回復'],['elixir','HP/MP回復'],['clear','状態異常解除'],['escape','脱出'],['revive','復活']];
 const sorts=kind==='circle'
  ?[['newest','登録が新しい順'],['oldest','登録が古い順'],['role','役割順'],['attribute','属性順'],['power','判明済みの威力順']]
  :[['default','所持品の順番'],['name','名前順'],['kind','種類順'],['value','効果量が高い順'],['value-asc','効果量が低い順']];
 $('pickerFilter').innerHTML=filters.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
 $('pickerSort').innerHTML=sorts.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
 $('pickerFilter').value=pickerView[kind].filter;
 $('pickerSort').value=pickerView[kind].sort;
 renderLoadoutChoices();
 $('clearLoadoutSlot').hidden=kind==='circle'?slots[index]===null:carry[index]===null;
 $('openGrimoireFromPicker').hidden=kind!=='circle';
 if(!dialog.open)dialog.showModal();
}
function closeLoadoutPicker(){
 const dialog=$('loadoutDialog');
 if(dialog.open)dialog.close();
 picker=null;
}
async function chooseLoadout(choice){
 if(!picker||profile.run)return;
 const {kind,index}=picker;
 if(kind==='circle'){
  if(choice!==null){
   const circle=circles[choice];if(!circle)return;
   slots=setSlot(slots,index,circle.id);
  }else slots=setSlot(slots,index,null);
  profile.slots=[...slots];
  await persist();
 }else{
  if(choice!==null){
   if(!profile.inventory[choice])return;
   carry=setSlot(carry,index,choice);
  }else carry=setSlot(carry,index,null);
  profile.carrySlots=saveCarrySlots(carry,profile.inventory);
  await persist();
 }
 closeLoadoutPicker();
 render();
}
function openDeleteDataDialog(){
 if(profile.run||activeAnalysis)return;
 $('deleteDataPhrase').value='';
 $('confirmDeleteData').disabled=true;
 $('deleteDataError').textContent='';
 if(!$('deleteDataDialog').open)$('deleteDataDialog').showModal();
}
async function eraseSaveData(){
 if(profile.run||activeAnalysis||$('deleteDataPhrase').value.trim()!=='削除')return;
 try{
  await clearDungeonData(db);
  stopCamera();
  circleImages.releaseAll();
  photoAnalysisEpoch++;
  lastCaptureRegistration=0;
  cameraReturnScroll=null;
  pendingCircleAction=null;
  picker=null;
  circles=[];
  profile=await getProfile(db);
  slots=prepareCircles(null,[],num('spell_slots'));
  carry=prepareItems([],0,G.capacity(profile.level));
  $('deleteDataDialog').close();
  note('');
  render();
  show('prepare');
  openNameDialog(true);
 }catch(e){
  $('deleteDataError').textContent='データの削除に失敗しました：'+e.message;
 }
}
function openNameDialog(required){
 const dialog=$('nameDialog');
 $('playerNameInput').value=profile.name||'';
 $('nameError').textContent='';
 $('cancelNameDialog').hidden=required;
 if(!dialog.open)dialog.showModal();
 $('playerNameInput').focus();
}
function wire(){
 tutorial=initCircleTutorial(document,async toCamera=>{
  profile.tutorialDone=true;
  try{await persist();}catch(error){note('チュートリアルの保存に失敗しました：'+error.message);}
  if(toCamera){show('library');$('cameraStart').focus();}
 });
 $('tutorialReplay').addEventListener('click',()=>{if(!profile.run&&!activeAnalysis)tutorial.open();});
 const listControls=[
  ['libraryRoleFilter','libraryRole'],['libraryAttributeFilter','libraryAttribute'],['librarySort','librarySort'],
  ['collectionDiscoveryFilter','collectionDiscovery'],['collectionRarityFilter','collectionRarity'],['collectionSort','collectionSort']
 ];
 for(const [id,key] of listControls){
  $(id).addEventListener('change',()=>{
   listView[key]=$(id).value||'all';
   render();
  });
 }
 $('startLayer').addEventListener('change',()=>{selectedStartLayer=allowedStartLayer(profile,$('startLayer').value);$('startLayer').value=String(selectedStartLayer);});
 for(const [id,key] of [['pickerFilter','pickerFilter'],['pickerSort','pickerSort']]){
  $(id).addEventListener('change',()=>{if(!picker)return;pickerView[picker.kind][key==='pickerFilter'?'filter':'sort']=$(id).value;renderLoadoutChoices();});
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.view){
  if(activeAnalysis?.type==='capture'){const request=activeAnalysis;activeAnalysis=null;photoAnalysisEpoch++;request.cancel?.();}
  cameraReturnScroll=null;
  // Browsing another tab does not dismiss the uncompleted rewards/EXP.
  if(returnFlow&&b.dataset.view==='dungeon')renderReturnStep();
   stopCamera();show(b.dataset.view);return;
 }
 if(b.dataset.action==='rename'){openNameDialog(false);return;}
 if(b.dataset.action==='delete-data'){openDeleteDataDialog();return;}
 if(b.dataset.circleDetail){openMagicDetails(b.dataset.circleDetail);return;}
 if(b.dataset.remove){askCircleAction('remove',b.dataset.remove);return;}
 if(b.dataset.upgrade){askCircleAction('upgrade',b.dataset.upgrade);return;}
 if(b.dataset.openSlot!==undefined){openLoadoutPicker('circle',Number(b.dataset.openSlot));return;}
 if(b.dataset.openItem!==undefined){openLoadoutPicker('item',Number(b.dataset.openItem));return;}
 if(b.dataset.chooseCircle!==undefined){await exclusive(()=>chooseLoadout(Number(b.dataset.chooseCircle)));return;}
 if(b.dataset.chooseItem!==undefined){await exclusive(()=>chooseLoadout(Number(b.dataset.chooseItem)));return;}
 if(b.dataset.cast!==undefined){await exclusive(()=>takeTurn(Number(b.dataset.cast)));return;}
 if(b.dataset.use!==undefined){await exclusive(()=>useItem(Number(b.dataset.use)));return;}
 });
 $('nameForm').addEventListener('submit',async event=>{
   event.preventDefault();
   if(busyAction)return;
   const name=$('playerNameInput').value.trim();
   if(!name||name.length>20){$('nameError').textContent='1〜20文字で入力してください';return;}
   const firstLesson=!profile.tutorialDone&&!circles.length&&!profile.attempts&&!profile.run;
   await exclusive(async()=>{profile.name=name;await persist();$('nameDialog').close();render();});
   if(firstLesson)tutorial.open();
 });
 $('cancelNameDialog').addEventListener('click',()=>$('nameDialog').close());
 $('nameDialog').addEventListener('cancel',event=>{if(!profile.name)event.preventDefault();});
 $('deleteDataPhrase').addEventListener('input',()=>{
  $('confirmDeleteData').disabled=$('deleteDataPhrase').value.trim()!=='削除';
 });
 $('cancelDeleteData').addEventListener('click',()=>$('deleteDataDialog').close());
 $('confirmDeleteData').addEventListener('click',()=>exclusive(eraseSaveData));
 $('closeMagicDetails').addEventListener('click',()=>$('magicDetailsDialog').close());
 $('upgradeCircle').addEventListener('click',()=>askCircleAction('upgrade',$('magicDetailsDialog').dataset.circleId));
 $('cancelCircleAction').addEventListener('click',()=>{$('circleActionDialog').close();pendingCircleAction=null;});
 $('circleActionDialog').addEventListener('close',()=>{pendingCircleAction=null;});
 $('confirmCircleAction').addEventListener('click',()=>exclusive(confirmCircleAction));
 $('magicDetailsDialog').addEventListener('animationend',e=>{if(e.animationName==='circle-upgrade-aura')$('magicDetailsDialog').dataset.enhancing='false';});
 $('closeLoadoutDialog').addEventListener('click',closeLoadoutPicker);
 $('openGrimoireFromPicker').addEventListener('click',()=>{closeLoadoutPicker();show('library');});
 $('clearLoadoutSlot').addEventListener('click',()=>exclusive(()=>chooseLoadout(null)));
 $('loadoutDialog').addEventListener('close',()=>{picker=null;});
 $('cameraStart').addEventListener('click',()=>exclusive(startCamera));$('cameraStop').addEventListener('click',stopCamera);$('cameraCapture').addEventListener('click',()=>exclusive(capture));
 $('startAttack').addEventListener('click',()=>exclusive(begin));$('returnHome').addEventListener('click',()=>exclusive(leave));
  $('returnNext').addEventListener('click',()=>exclusive(advanceReturnStep));
  $('openAdventurerShare').addEventListener('click',openAdventurerShare);
  $('supportPromptClose').addEventListener('click',()=>$('supportPromptDialog').close());
  $('supportDonateLink').addEventListener('click',()=>$('supportPromptDialog').close());
  $('supportXLink').addEventListener('click',()=>$('supportPromptDialog').close());
  $('supportSaveImage').addEventListener('click',downloadAdventurerCard);
  $('supportNativeShare').addEventListener('click',shareAdventurerCardImage);
 for(const choice of ['restore','collection','item'])$('bonus-'+choice)?.addEventListener('click',()=>exclusive(()=>claimBonus(choice)));
 $('deeper').addEventListener('click',()=>exclusive(async()=>{const run=profile.run;if(!run||run.stage!=='checkpoint')return;const previousScroll=run.checkpointBattleScrollY;delete run.checkpointBattleScrollY;run.floor++;run.bonusClaimed=false;enterFight();await persist();renderRun();show('battle');restoreContinuedBattleScroll(previousScroll);await ceremony('encounter','ENCOUNTER',run.enemyName+' が現れた');}));
 $('cancelAnalyze').addEventListener('click',()=>{
  const request=activeAnalysis,capture=request?.type==='capture';
  activeAnalysis=null;
  request?.cancel?.();
  if(capture)photoAnalysisEpoch++;
  $('analyzerFrame').onload=null;
  $('analyzerFrame').src='about:blank';
  note('');
  if(capture){show('library');returnToCameraScroll();}
  else {renderRun();show('battle');}
 });
 window.addEventListener('beforeunload',()=>{stopCamera();circleImages.releaseAll();});
}
load().catch(failStartup);
