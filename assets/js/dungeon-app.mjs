import * as G from './dungeon-core.mjs?v=20261023.25';
import {inkEnhancedAnalysis,MAGIC_INK_NAME} from './dungeon-ink.mjs?v=20261023.25';
import {playCombatSequence,playBattleCeremony,effectCaption,effectDuration,attackHitAffinity,magicEffectTier,bossCeremonyTier,ceremonyDuration,treasureChestMarkup,combatPhaseDuration} from './dungeon-combat-fx.mjs?v=20261023.25';
import {createBattleInputBuffer} from './dungeon-battle-input.mjs?v=20261023.25';
import {captureCombatFxEcho} from './dungeon-combat-fx-echo.mjs?v=20261023.25';
import {canDepartWithCircles,circleSummary,circleCardInfo,circleDetails,isRevealed,revealOnUse,newCapturedCircle,savePreanalysis,normalizeAnalysisResult,successfulDungeonAnalysis,failedDungeonAnalysis,circleEffectDetails} from './dungeon-magic-knowledge.mjs?v=20261023.25';
import {prepareCircles,prepareItems,setSlot,pickedValues,isFull,ensureItemInstances,saveCarrySlots,restoreCarrySlots,validCarrySlots} from './dungeon-loadout.mjs?v=20261023.25';
import {spellGrid,itemGrid,circleChoices,itemChoices,circleEffectBadges,itemSymbol,itemEffectText,itemEffectIcons} from './dungeon-preparation-ui.mjs?v=20261023.25';
import {circleListIndexes,itemListIndexes,collectionListIndexes,collectionRarityMarks} from './dungeon-list-view.mjs?v=20261023.25';
import {relicSymbolSvg} from './dungeon-relic-symbols.mjs?v=20261023.25';
import {newestCirclesFirst,nextCircleRegistration} from './dungeon-circle-order.mjs?v=20261023.25';
import {configure,num,floor as floorMaster} from './dungeon-tuning.mjs';
import {enemyForFight,layerForFight,shuffledLayerEnemyIds,isBonusLayer,bonusCollection,bonusConsumable} from './dungeon-design.mjs?v=20261023.25';
import {FIGHTS_PER_LAYER,isLayerBoss,encounterLabel,battleHeading,battleEncounter,clearedLayer,recordReturnedLayer,deepestReturnedLayer,recordReachedLayer,deepestReachedLayer,hasHundredFloorCrown,dungeonDepthBlend} from './dungeon-progress.mjs?v=20261023.25';
import {upgradeCircle,savedUpgrade,combatSpell,upgradeStoneCost} from './dungeon-upgrades.mjs?v=20261023.25';
import {openStore,allCircles,putCircle,deleteCircle,saveProfile,getProfile,readDungeonSnapshot,clearDungeonData,saveProfileWithCircles,saveHeirName} from './dungeon-store.mjs?v=20261023.25';
import {initDungeonCloudSync} from './dungeon-cloud-sync.mjs?v=20261023.25';
import {verifyLocalSnapshot} from './dungeon-cloud-integrity.mjs?v=20261023.25';
import {createDungeonPhotoManager} from './dungeon-photo-manager.mjs?v=20261023.25';
import {clearLegacyThumbnailCache} from './dungeon-legacy-cache.mjs?v=20261023.25';
import {RETURN_XP_DURATION_MS,returnXpFrame} from './dungeon-return-fx.mjs?v=20261023.25';
import {ADVENTURER_RANKS,highestRankLayer,rankTitle,rankBadgeName,unlockedStartLayers,allowedStartLayer,rankBadgeDrop,acquireAdventurerRank} from './dungeon-ranks.mjs?v=20261023.25';
import {statusBadges} from './dungeon-status-ui.mjs?v=20261023.25';
import {supportPromptForReturn} from './dungeon-support.mjs?v=20261023.25';
import {adventurerShareData,adventurerShareText,adventurerXUrl,paintAdventurerCard,DUNGEON_SHARE_URL} from './dungeon-share.mjs?v=20261023.25';
import {initCircleTutorial} from './dungeon-tutorial.mjs?v=20261023.26';
import {initMagicStoneTutorial,shouldShowMagicStoneTutorial} from './dungeon-magic-stone-tutorial.mjs?v=20261023.25';
import {selectCardCircle} from './dungeon-card-art.mjs?v=20261023.25';
import {renderBattleCards} from './dungeon-battle-cards.mjs?v=20261023.25';
import {playCircleReveal,playCircleUpgrade,CIRCLE_RITUAL_DURATION_MS} from './dungeon-circle-ritual.mjs?v=20261023.25';
import {createSuccessorProfile,legacyContents,reclaimLegacies,markCircleCreator,circleRelicHistory,circleLegacyLevelSources,totalLegacyLevel} from './dungeon-permadeath.mjs?v=20261023.25';
import {isDungeonNameBlocked} from './dungeon-name-filter.mjs?v=20261023.25';
import {initCircleDrawing,drawnPower,withDrawnPowerFloor,MIN_DUNGEON_POWER} from './dungeon-circle-draw.mjs?v=20261023.26';
import {hideUiOverlay} from './dungeon-ui-transitions.mjs?v=20261023.26';
let cloudSyncController,drawingEditor;
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,circles=[],masters={},slots=[],carry=[],stream=null,repairStream=null,repairCameraEpoch=0,activeAnalysis=null,picker=null,selectedStartLayer=null;
const listView={
 libraryRole:'all',libraryAttribute:'all',librarySort:'newest',
 collectionDiscovery:'all',collectionRarity:'all',collectionSort:'common',
 pickerFilter:'all',pickerSort:'newest'
};
const pickerView={circle:{filter:'all',sort:'newest'},item:{filter:'all',sort:'default'}};
const circleImages=createDungeonPhotoManager(()=>db,id=>circles.find(c=>c.id===id));
function refreshCirclePhotos(){
 circleImages.refresh([...sceneIds.filter(id=>!$(id).hidden).map(id=>$(id)),
  ...($('loadoutDialog').open?[$('loadoutDialog')]:[])]);
}
async function revealOriginal(circle,failed=false){
 // Full-resolution photo Blob is the same one used by the magic details screen.
 // Only the grimoire/preparation/battle cards should request thumbnails.
 let originalUrl='';
 try{originalUrl=circleImages.get(circle.image);}
 catch{/* A missing photo URL should not prevent viewing analysis results. */}
 await playCircleReveal(circle,originalUrl,{failed});
}
const failedPhotoIds=new Set();
function onCirclePhotoError(event){
 const img=event.target,id=img?.dataset?.circlePhotoId;
 const circle=id&&circles.find(item=>item.id===id);
 if(!circle||img.isConnected===false)return;
 const src=img.getAttribute?.('src')||img.src;
 if(!src)return;
 if(img!==$('magicDetailsImage')){img.alt='縮小画像を表示できません。';return;}
 if(!$('magicDetailsDialog').open)return;
 if(src!==circleImages.get(circle.image))return;
 // No automatic URL retry, decoder restart, or save mutation.
 failedPhotoIds.add(id);
 img.alt='写真を表示できません。詳細から撮り直せます。';
 if($('magicDetailsDialog').dataset.circleId===id)$('repairSelectedCircleImage').hidden=false;
}
function onCirclePhotoLoad(event){
 const img=event.target;
 if(img!==$('magicDetailsImage')||!$('magicDetailsDialog').open)return;
 const id=img.dataset?.circlePhotoId,circle=id&&circles.find(item=>item.id===id);
 if(!circle||img.src!==circleImages.get(circle.image))return;
 failedPhotoIds.delete(id);
 if($('magicDetailsDialog').dataset.circleId===id)$('repairSelectedCircleImage').hidden=true;
}
let dungeonView='prepare';
let busyAction=false,playingEffects=false,savingName=false;
const battleInput=createBattleInputBuffer();
let loadoutSaveQueue=Promise.resolve(),loadoutSaveRevision=0;
let photoAnalysisEpoch=0,lastCaptureRegistration=0,cameraReturnScroll=null,pendingCircleAction=null,upgradeRitualEpoch=0;
let returnFlow=null,returnAnimationToken=0,tutorial=null,magicStoneTutorial=null;
async function exclusive(fn){if(busyAction)return;busyAction=true;try{return await fn();}finally{busyAction=false;}}
async function battleAction(kind,index){
 const run=profile?.run;
 if(busyAction){
  // Buffer only during the final, still-living combat phase; not during ceremonies.
  if(playingEffects&&run?.stage==='battle'&&run.hero.hp>0&&run.enemy.hp>0)
   battleInput.offer({kind,index,floor:run.floor});
  return;
 }
 try{
  await exclusive(()=>kind==='cast'?takeTurn(index):useItem(index));
 }finally{
  const next=battleInput.take();
  // A buffered action must never spill into the next encounter or after a defeat.
  const current=profile?.run;
  if(next&&current?.stage==='battle'&&current.floor===next.floor&&current.hero.hp>0&&current.enemy.hp>0)
   void battleAction(next.kind,next.index).catch(error=>note('戦闘操作に失敗しました：'+String(error?.message||error)));
 }
}
function note(message){
 const targets=['pageError','battleError','cameraError'];
 for(const id of targets){$(id).hidden=true;$(id).textContent='';}
 if(!message||!/できません|失敗|不足|見つからない|不正|中断|対応ブラウザ|開けません|起動できません|してください/.test(message))return;
 const target=/カメラ|撮影|HTTPS|localhost/.test(message)?'cameraError':profile?.run?'battleError':'pageError';
 $(target).textContent=message;$(target).hidden=false;
 // Save errors must stay visible until explicitly acknowledged.
 if(/保存|セーブ|整合性|破損/.test(message)){
  $('saveErrorMessage').textContent=message;
  const dialog=$('saveErrorDialog');
  if(!dialog.open)dialog.showModal();
 }
}
async function persist(){
 try{await loadoutSaveQueue;await saveProfile(db,profile);}
 catch(error){note('セーブの保存に失敗しました：'+String(error?.message||error));throw error;}
}
// Registered photo bytes are immutable. Analysis/reveal changes live only in
// profile metadata, and one ordinary profile save seals their update.
function rememberCircleMetadata(circle){
 const {image,...metadata}=circle;
 profile.magicOverrides={...(profile.magicOverrides||{}),[circle.id]:metadata};
}
function openBackupSetup(){
 if(profile.name)return;
 $('backupSetupStatus').textContent=$('googleDriveStatus').textContent;
 if(!$('backupSetupDialog').open)$('backupSetupDialog').showModal();
}
function finishBackupSetup(){
 if($('backupSetupDialog').open)$('backupSetupDialog').close();
 if(!profile.name)openNameDialog(true);
}
async function refreshRepairStatus(){
 const health=await verifyLocalSnapshot(await readDungeonSnapshot(db));
 $('repairMagicCirclePhotos').hidden=health.status!=='badImages';
 return health;
}
async function handleDriveImageRepair(){
 circleImages.releaseAll();
 failedPhotoIds.clear();
 circles=newestCirclesFirst((await allCircles(db)).map(withDrawnPowerFloor));
 slots=prepareCircles(profile.slots,circles.map(c=>c.id),num('spell_slots'));
 await refreshRepairStatus();
 render();
 if(profile.run){if(profile.run.stage==='checkpoint')renderCheckpoint();else renderRun();}
}
async function recaptureMissingImages(ids){
 const dialog=$('imageRepairDialog'),video=$('imageRepairVideo'),canvas=$('imageRepairCanvas');
 const message=$('imageRepairCircleName'),error=$('imageRepairError'),button=$('imageRepairCapture');
 const remaining=[...new Set(ids)];
 if(!remaining.length)return true;
 return new Promise(resolve=>{
  let done=false,working=false;
  const finish=ok=>{
   if(done)return;
   done=true;button.onclick=null;$('imageRepairStart').onclick=null;$('imageRepairLater').onclick=null;dialog.oncancel=null;
   stopRepairCamera();
   if(dialog.open)dialog.close();
   resolve(ok);
  };
  const display=()=>{
   const id=remaining[0],circle=circles.find(c=>c.id===id);
   message.textContent=(circle?.name||'魔法陣')+'（'+(ids.length-remaining.length+1)+' / '+ids.length+'）';
   error.textContent='';
  };
  button.onclick=async()=>{
   if(done||working||!remaining.length||!repairStream)return;
   working=true;button.disabled=true;
   try{
    const file=await cameraPhotoBlob(video,canvas);
    if(!file)throw Error('撮影画像を作成できません。');
    const id=remaining[0],original=circles.find(c=>c.id===id);
    if(!original)throw Error('魔法陣の記録が見つかりません。');
    await putCircle(db,{...original,image:file},{repairImage:true});
    circleImages.forget(id,original.image);
    failedPhotoIds.delete(id);
    circles=circles.map(c=>c.id===id?{...c,image:file}:c);
    remaining.shift();
    await refreshRepairStatus();
    render();
    if(!remaining.length)finish(true);
    else display();
   }catch(e){error.textContent='写真を保存できませんでした：'+e.message;}
   finally{working=false;button.disabled=false;}
  };
  $('imageRepairStart').onclick=()=>{void startRepairCamera();};
  $('imageRepairLater').onclick=()=>{if(!working)finish(false);};
  dialog.oncancel=event=>{event.preventDefault();if(!working)finish(false);};
  display();
  dialog.showModal();
  void startRepairCamera();
 });
}
function startupStage(message){$('startupDetail').textContent=message;}
function finishStartup(){
 $('dungeonApp').removeAttribute('inert');
 $('dungeonApp').setAttribute('aria-busy','false');
 $('startupMask').setAttribute('aria-busy','false');
 hideUiOverlay($('startupMask'));
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
  const res=await fetch('assets/data/'+file+'?v='+$('dungeonApp').dataset.release);
  if(!res.ok)throw Error(file+' の取得に失敗');
  masters[key]=G.parseCsv(await res.text());
 }
 startupStage('迷宮の掟を読み解いている…');
 configure(masters);
 G.validateMasters(masters.enemies,masters.items,masters.collections,masters.buffs);
 startupStage('冒険者の記録を整えている…');
 profile=await getProfile(db);
 const initialSnapshot=await readDungeonSnapshot(db);
 const initialHealth=await verifyLocalSnapshot(initialSnapshot);
 if(initialHealth.status==='corrupt'){
  // Do not start the game or create new integrity evidence from corrupt data.
  // Require a healthy Drive recovery before any player interaction is allowed.
  startupStage('セーブの破損を検出しました。Driveからの復元が必要です。');
  wire();
  cloudSyncController=initDungeonCloudSync({db,button:$('connectGoogleDrive'),status:$('googleDriveStatus'),
   onRestore:()=>location.reload(),onInitialReady:finishBackupSetup,onRepairImages:recaptureMissingImages,onImagesRestored:handleDriveImageRepair});
  $('backupSetupTitle').textContent='セーブの破損を検出しました';
  $('setupWithoutBackup').disabled=true;
  finishStartup();
  $('backupSetupDialog').showModal();
  return;
 }
 profile.legacies??=[];
 returnFlow=Array.isArray(profile.pendingReturn?.steps)&&profile.pendingReturn.steps.length?profile.pendingReturn:null;
 if(!Array.isArray(profile.obtainedItemIds))profile.obtainedItemIds=[...new Set([...(profile.inventory||[]),...(profile.run?.carry||[])].filter(Boolean).map(item=>item.id).filter(Boolean))];
 G.repairInvalidMp(profile.run?.hero);
 profile.adventurerRank=highestRankLayer(profile);
 profile.defeatedBosses??={};
 for(const relic of masters.collections)if(relic.boss_enemy_id&&Number(profile.collection?.[relic.id]||0)>0)profile.defeatedBosses[relic.boss_enemy_id]=true;
 profile.magicStones=Math.max(0,Number(profile.magicStones)||0);
 profile.magicInk=Math.max(0,Math.trunc(Number(profile.magicInk)||0));
 profile.deepestReturnedLayer=deepestReturnedLayer(profile);
  profile.deepestReachedLayer=deepestReachedLayer(profile);
 startupStage('魔導書の頁を並べている…');
 circles=newestCirclesFirst((await allCircles(db)).map(withDrawnPowerFloor));
 // Restore original MP cost for expeditions saved before this change.
 const activeSpells=profile.run?.hero?.spells;
 if(Array.isArray(activeSpells))for(const [index,id] of (profile.run.slotIds||[]).entries()){
  const circle=circles.find(c=>c.id===id);
  if(activeSpells[index]&&circle?.basePower>0)activeSpells[index].basePower=circle.basePower;
  // Refresh FX investment in expeditions saved before tiered animation was added.
  if(activeSpells[index]&&circle){
   activeSpells[index].upgradeLevel=Number.isSafeInteger(circle.upgradeLevel)?circle.upgradeLevel:0;
   // Refresh old spell totals in an unfinished expedition.
   const inherited=combatSpell(circle);
   if(inherited?.legacyHp>0){
    activeSpells[index].legacyHp=inherited.legacyHp;
    activeSpells[index].legacyHpSources=inherited.legacyHpSources;
   }
  }
 }
 slots=prepareCircles(profile.slots,circles.map(c=>c.id),num('spell_slots'));
 ensureItemInstances(profile);
 if(!profile.run)profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 carry=profile.run?prepareItems([],profile.inventory.length,G.capacity(profile.level)):restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 startupStage('迷宮の扉を開いている…');
 // Reading the game must not advance savedAt or conceal a damaged prior seal.
 wire();
 cloudSyncController=initDungeonCloudSync({db,button:$('connectGoogleDrive'),status:$('googleDriveStatus'),
  onRestore:()=>location.reload(),onInitialReady:finishBackupSetup,onRepairImages:recaptureMissingImages,onImagesRestored:handleDriveImageRepair});
 render();
 if(profile.run){if(profile.run.stage==='checkpoint')renderCheckpoint();else renderRun();}
 if(returnFlow)renderReturnStep();
 show(returnFlow?'returnShowcase':profile.run?(profile.run.stage==='checkpoint'?'checkpoint':'battle'):'prepare');
 $('repairMagicCirclePhotos').hidden=initialHealth.status!=='badImages';
 finishStartup();
 if(profile.run?.stage==='checkpoint'&&profile.run.creatorCongratulationsPending)showCreatorCongratulations();
 if(profile.awaitingHeir)openNameDialog(true);
 else if(!profile.name)openBackupSetup();
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
 refreshCirclePhotos();
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
  refreshCirclePhotos();
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
function imageUrl(){return '';}
function battleImageUrl(){return '';}
function renderHeroName(hero){
 const name=$('heroName'),displayName=profile.name?.trim()||'名もなき冒険者';
 const crowned=hasHundredFloorCrown(profile);
 name.textContent=displayName+(crowned?' 👑':'')+(hero.reviveArmed?' 🪽':'');
 $('heroLevel').textContent='Lv.'+hero.level;
 if(hero.reviveArmed){
  name.setAttribute('title','生命の紅石：復活待機中');
  name.setAttribute('aria-label',displayName+(crowned?'・100層ボス討伐':'')+'・生命の紅石：復活待機中');
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
function itemName(item){return masters.items.find(x=>x.id===item.id)?.name||item.id;}
function roleText(text){return String(text).replace(/通常攻撃|攻撃|防御|弱体|回復/g,word=>({'通常攻撃':'⚔️通常攻撃',攻撃:'⚔️攻撃',防御:'🛡️防御',弱体:'🕸️弱体',回復:'✚回復'})[word]);}
function render(){
 carry=prepareItems(carry,profile.inventory.length,G.capacity(profile.level));

 const s=G.stats(profile.base,profile.level),atLevelCap=profile.level>=num('level_max'),experienceNeeded=atLevelCap?0:G.nextXp(profile.level),xpProgress=atLevelCap?100:Math.min(100,100*profile.xp/experienceNeeded);
 const maxMp=num('mp_base')+num('mp_per_mag')*s.mag;
 const name=esc(profile.name||'名もなき冒険者');
 const crown=hasHundredFloorCrown(profile)?'<span class="hundred-floor-crown" role="img" aria-label="100層ボス討伐の証">👑</span>':'';
 const reached=deepestReachedLayer(profile),returned=deepestReturnedLayer(profile);
 $('playerStats').innerHTML='<div class="character-name-row"><h3 class="character-name">'+name+crown+'</h3><button class="subtle" data-action="rename">名前変更</button></div>'
 +'<div class="level-line"><strong>Lv.'+profile.level+'</strong><span>'+(atLevelCap?'EXP MAX':'EXP '+profile.xp+' / '+experienceNeeded)+'</span></div><div class="xp-track" role="progressbar" aria-label="経験値" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(xpProgress)+'"><div class="xp-fill" style="width:'+xpProgress+'%"></div></div>'
 +'<div class="stat-grid">'+['hp','mp','mag','def','res'].map(k=>'<div class="stat-cell"><small>'+k.toUpperCase()+'</small><strong>'+(k==='mp'?maxMp:s[k])+'</strong></div>').join('')+'</div>'
 +'<p class="adventure-record">携行品上限：'+G.capacity(profile.level)+'個 ｜ 帰還 '+profile.returns+'</p>'
 +'<div class="adventure-depth-record"><span>最深到達階層：<strong>'+(reached?reached+'層':'-')+'</strong></span><span>最深帰還階層：<strong>'+(returned?returned+'層':'-')+'</strong></span></div>'
  +'<p class="adventurer-grade">冒険者等級：<strong data-rank="'+highestRankLayer(profile)+'"><span>'+rankTitle(highestRankLayer(profile))+'</span></strong></p>';
 const obtained=masters.collections.filter(item=>Number(profile.collection[item.id]||0)>0).length;
 $('collectionProgress').innerHTML='<strong>'+obtained+' / '+masters.collections.length+'</strong><small>DISCOVERED</small><div class="collection-track"><div class="collection-fill" style="width:'+(100*obtained/masters.collections.length)+'%"></div></div>';
 // Collection symbols are rendered as centered SVG paths.
 // Shapes and readable names supplement color; unknown collection rarity stays hidden.
 const rarityNames={common:'コモン',uncommon:'アンコモン',rare:'レア',
  epic:'エピック',legendary:'レジェンダリー'};
 const collectionIndexes=collectionListIndexes(masters.collections,profile.collection,{
  discovery:listView.collectionDiscovery,rarity:listView.collectionRarity,sort:listView.collectionSort
 });
 $('collectionGrid').innerHTML=collectionIndexes.map(i=>{
  const item=masters.collections[i];
  const count=Number(profile.collection[item.id]||0),found=count>0;
  const rarity=['common','uncommon','rare','epic','legendary'].includes(item.rarity)?item.rarity:'common';
  const mark=relicSymbolSvg(i,found);
  return '<article class="relic-card '+(found?'discovered':'locked')+'" data-rarity="'+(found?rarity:'unknown')+'" role="listitem" aria-label="'+(found?esc(item.name)+'・'+rarityNames[rarity]:'未発見の収集品')+'">'
   +(found?'<span class="relic-count">×'+count+'</span>':'')
   +'<div class="relic-art" aria-hidden="true">'+mark+'</div>'
   +(found?'<span class="relic-rarity" aria-hidden="true">'+collectionRarityMarks(rarity)+'</span>':'')
   +'<div class="relic-name">'+(found?esc(item.name):'？？？')+'</div>'
   +'<p class="relic-detail">'+(found?esc(item.description):'未発見')+'</p></article>';
 }).join('')||'<p class="collection-empty">該当するコレクションはありません。</p>';
 $('magicStoneBalance').textContent='✦ 魔導石：'+profile.magicStones+'個';
 $('magicInkBalance').textContent=MAGIC_INK_NAME+'：'+(profile.magicInk||0)+'個';
 $('useMagicInk').disabled=Boolean(profile.run)||Boolean(activeAnalysis)||!(profile.magicInk>0);
 if($('useMagicInk').disabled)$('useMagicInk').checked=false;
  const circleIndexes=circleListIndexes(circles,{
   role:listView.libraryRole,attribute:listView.libraryAttribute,sort:listView.librarySort,slots
  });
  $('libraryCards').innerHTML=circleIndexes.map(i=>circles[i]).map(c=>'<article class="card" data-circle-id="'+esc(c.id)+'" data-favorite="'+(profile.favoriteCircleId===c.id)+'" data-attribute="'+esc(c.analysis?.attribute||'unknown')+'"><span class="circle-photo-face"><img alt="魔法陣" loading="lazy" decoding="async" data-circle-photo-id="'+esc(c.id)+'" role="button" tabindex="0" aria-label="長押しでお気に入りを切り替え" aria-pressed="'+(profile.favoriteCircleId===c.id)+'"></span>'+circleEffectBadges(c,masters.buffs,esc,G.mpCost)+'<div class="card-actions"><button type="button" class="subtle magic-expand" data-circle-detail="'+esc(c.id)+'">詳細</button><button type="button" class="subtle" data-remove="'+esc(c.id)+'" '+(profile.run?'disabled':'')+'>削除</button><button type="button" class="subtle upgrade-action" data-upgrade="'+esc(c.id)+'" '+(profile.run||!isRevealed(c)||profile.magicStones<upgradeStoneCost(c.upgradeLevel??0)?'disabled':'')+'>✦ 魔導石で強化</button></div></article>').join('')||'<p class="collection-empty">'+(circles.length?'条件に合う魔法陣はありません。':'魔導書はまだ白紙。')+'</p>';
 $('slotCards').innerHTML=spellGrid(slots,circles,imageUrl,esc,!profile.run,masters.buffs,G.mpCost);
 const unlocked=profile.returns>0||profile.inventory.length>0,limit=G.capacity(profile.level);
 $('gearCards').innerHTML=itemGrid(carry,profile.inventory,limit,unlocked,itemName,esc,!profile.run);
 $('gearCounter').textContent=unlocked?'携行品 '+pickedValues(carry.slice(0,limit)).length+' / '+limit+' 個':'携行品：最初の帰還後に解放';
 selectedStartLayer=selectedStartLayer===null?unlockedStartLayers(profile).at(-1):allowedStartLayer(profile,selectedStartLayer);
 $('startLayer').innerHTML=unlockedStartLayers(profile).map(layer=>'<option value="'+layer+'">'+(layer===1?'1層から':layer+'層から（'+rankTitle(layer-1)+'）')+'</option>').join('');
 $('startLayer').value=String(selectedStartLayer);
 $('startLayer').disabled=Boolean(profile.run);
 $('startAttack').disabled=!canDepartWithCircles(slots)||Boolean(profile.run);
 $('deleteSaveData').disabled=Boolean(profile.run);
 $('circleCounter').textContent='魔法陣 '+slots.filter(Boolean).length+' / 3〜5 個';
 refreshCirclePhotos();
}
function rewardLedgerMarkup(run){
 return '<div class="battle-stat" data-kind="xp">'
   +'<span class="battle-stat-label"><span aria-hidden="true">✧</span> 獲得EXP</span>'
   +'<strong class="battle-stat-value">+'+run.xp+'</strong>'
   +'<small>帰還時に確定</small></div>'
  +'<div class="battle-stat" data-kind="loot">'
   +'<span class="battle-stat-label"><span aria-hidden="true">✥</span> 戦利品</span>'
   +'<strong class="battle-stat-value">'+run.loot.length+'</strong>'
   +'<small>帰還時に確定</small></div>';
}
function updateDungeonPanelBackground(fight){
 const {crimson,darkness,fog}=dungeonDepthBlend(fight);
 for(const id of ['battle','checkpoint']){
  $(id).setAttribute('style','--dungeon-crimson:'+crimson+';--dungeon-darkness:'+darkness+';--dungeon-fog:'+fog);
  $(id).setAttribute('data-mist',fog==='0%'?'false':'true');
 }
}
function renderRun(){
 const run=profile.run;if(!run)return;
 updateDungeonPanelBackground(run.floor);
 const enemy=run.enemy,hero=run.hero;
 $('floorLabel').textContent=battleHeading(run.floor);
 $('battleEncounterLabel').textContent=battleEncounter(run.floor);
 $('enemyName').textContent=run.enemyName;
 $('enemyLevel').textContent='Lv.'+enemy.level;
 renderHeroName(hero);
 $('enemyStats').innerHTML=rowUnit(enemy);
 $('heroStats').innerHTML=rowUnit(hero);
 const spellStates=run.slotIds.map((id,i)=>{
  const c=circles.find(x=>x.id===id);
  if(!id||!c?.image)return null;
  const s=hero.spells[i],waiting=hero.cooldowns[i]||0;
  const disabled=Boolean(s&&!G.canCast(hero,i)),sealed=G.isSpellSealed(hero,s);
  const info=circleCardInfo(c,masters.buffs,G.mpCost);
  return {disabled,sealed,
   label:'魔法陣の編成枠 '+(i+1)+' '+(c.analysis?circleSummary(c,masters.buffs,G.mpCost):'未解析')+(sealed?' 封印':''),
   cooldown:waiting?'待機 '+waiting:'発動',mp:'MP:'+info.mp,power:'威力:'+info.power};
 });
 const layout=JSON.stringify(run.slotIds.map((id,i)=>[id,Boolean(spellStates[i])]));
 renderBattleCards($('battleSpells'),layout,()=>run.slotIds.map((id,i)=>{
  const c=circles.find(x=>x.id===id),state=spellStates[i];
  // Empty slots must not look castable; a missing saved photo is an explicit error.
  if(!id)return '<div class="battle-spell-frame"><div class="loadout-tile battle-tile battle-spell-tile empty" aria-label="魔法陣の編成枠 '+(i+1)+' 未装備">'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<span class="tile-empty-icon" aria-hidden="true">＋</span><span class="tile-title">未装備</span></div></div>';
  if(!state)return '<div class="battle-spell-frame"><div class="loadout-tile battle-tile battle-spell-tile unavailable" aria-label="魔法陣の編成枠 '+(i+1)+' 画像が見つかりません">'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<span class="tile-empty-icon" aria-hidden="true">！</span><span class="tile-title">画像なし</span></div></div>';
  return '<div class="battle-spell-frame"><button type="button" class="loadout-tile battle-tile battle-spell-tile '+(state.disabled?'unavailable':'equipped')+'" data-attribute="'+esc(c.analysis?.attribute||'unknown')+'" data-cast="'+i+'" aria-label="'+esc(state.label)+'" '+(state.disabled?'disabled':'')+'>'
    +'<span class="tile-index">'+String(i+1).padStart(2,'0')+'</span>'
    +'<span class="battle-spell-photo circle-photo-face"><img alt="" loading="lazy" decoding="async" data-circle-photo-id="'+esc(c.id)+'">'
    +(state.sealed?'<span class="battle-spell-seal" aria-hidden="true">封</span>':'')+'</span>'
    +'<span class="tile-cooldown">'+state.cooldown+'</span></button>'
    +circleEffectBadges(c,masters.buffs,esc,G.mpCost)
    +'<button type="button" class="subtle magic-expand" data-circle-detail="'+esc(c.id)+'">詳細</button></div>';
 }).join(''),spellStates);
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
   +'<span class="tile-item-effect item-effect-icons" aria-hidden="true">'+itemEffectIcons(item)+'</span></button>';
 }).join('');
 $('battleInfo').innerHTML=rewardLedgerMarkup(run)
  +(hero.reviveArmed?'<div class="battle-revival">🪽 生命の紅石 · 復活待機中</div>':hero.reviveUsed?'<div class="battle-revival">🪽 生命の紅石 · 発動済み</div>':'');
 $('battleLog').innerHTML=run.log.slice(-15).map(x=>'<p>'+esc(roleText(x))+'</p>').join('');
 refreshCirclePhotos();
}
function clearCombatEffects(){
 $('battleArena').dataset.shake='false';
 for(const side of ['hero','enemy']){
  const target=$(side+'Combatant');
  target.dataset.effect='idle';
  target.dataset.tier='1';
  target.dataset.hit='false';
  target.dataset.affinity='none';
  target.dataset.incoming='none';
  target.dataset.incomingAttribute='law';
  target.dataset.incomingTier='1';
  $(side+'Projectile').dataset.effect='idle';
  $(side+'Projectile').dataset.tier='1';
  $(side+'FxText').textContent='';
 }
}
async function animateBattle(steps){
 if(!steps.length)return;
 playingEffects=true;
 let lastEcho=null;
 $('battleSpells').setAttribute('aria-busy','true');
 $('battleItems').setAttribute('aria-busy','true');
 try{
  await playCombatSequence(steps,phase=>{
   lastEcho?.reveal();
   clearCombatEffects();
   // Force a new CSS animation cycle even after consecutive turns with the same role.
   void $('battleArena').offsetWidth;
   $('battleArena').dataset.shake=phase.some(step=>['attack','basic'].includes(step.role)&&step.amount>0)?'true':'false';
   for(const step of phase){
    const actor=$(step.side+'Combatant');
    actor.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
    actor.dataset.effect=step.role;
    actor.dataset.tier=String(magicEffectTier(step.upgradeLevel,step.role));
    // Magic attacks travel across the arena from their caster to their target.
    // Each simultaneous fighter controls a separate projectile.
    if(step.role==='attack'){
     const projectile=$(step.side+'Projectile');
     projectile.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
     projectile.dataset.effect='attack';
     projectile.dataset.tier=actor.dataset.tier;
    }
    $(step.side+'FxText').textContent=effectCaption(step);
   }
   for(const step of phase){
    if(!['attack','basic','debuff'].includes(step.role))continue;
    const opponent=step.side==='hero'?'enemy':'hero';
    const victim=$(opponent+'Combatant');
    victim.dataset.hit='true';
    if(step.role==='attack')victim.dataset.affinity=attackHitAffinity(step);
    victim.dataset.incoming=step.role;
    victim.dataset.incomingAttribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
    victim.dataset.incomingTier=String(magicEffectTier(step.upgradeLevel,step.role));
    if(victim.dataset.effect==='idle')victim.dataset.attribute=G.ATTRS.includes(step.attribute)?step.attribute:'law';
   }
   const final=phase.at(-1);
   renderHeroName(final.hero);
    $('heroStats').innerHTML=rowUnit(final.hero);
   $('enemyStats').innerHTML=rowUnit(final.enemy);
   lastEcho=captureCombatFxEcho($('battleArena'),combatPhaseDuration(phase,effectDuration()));
  },{overlap:125,onLastPhase:(_phase,duration)=>battleInput.begin(duration),onFatal:side=>ceremony(side==='hero'?'hero-death':'enemy-death',
   side==='hero'?'探索失敗':'討伐成功',
   side==='hero'?(profile.name||'冒険者'):(profile.run?.enemyName||''))});
 }finally{
  battleInput.close();
  lastEcho?.reveal();
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
 recordReachedLayer(profile,run.floor);
 run.hero.reviveArmed=false;run.hero.reviveUsed=false;
 // Keep the previous defeated opponent hidden while the next opponent is prepared.
 // The encounter ceremony reveals the replacement after renderRun().
 run.enemy=unit;run.enemyName=name;run.stage='battle';run.log.push(encounterLabel(run.floor)+(isLayerBoss(run.floor)?'・階層ボス':'')+'：'+name+'が現れた');}
function narrativeLines(id,lines){$(id).textContent=lines.join('\n');}
function renderCheckpoint(){
 const run=profile.run;if(!run)return;
 updateDungeonPanelBackground(run.floor);
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
 photoAnalysisEpoch++;const selectedIndices=pickedValues(carry);profile.carrySlots=saveCarrySlots(carry,profile.inventory);const selected=carry.map(i=>Number.isInteger(i)?profile.inventory[i]:null);for(const i of [...selectedIndices].sort((a,b)=>b-a))profile.inventory.splice(i,1);const hero=G.makeUnit(profile.base,profile.level,{},slots.map(id=>{return combatSpell(circles.find(c=>c.id===id));}),'player');profile.slots=[...slots];profile.run={floor:(startLayer-1)*FIGHTS_PER_LAYER+1,slotIds:[...slots],hero,enemy:null,carry:selected,loot:[],xp:0,log:[],stage:'battle'};profile.attempts++;enterFight();carry=prepareItems([],profile.inventory.length,G.capacity(profile.level));await persist();renderRun();show('battle');scrollToDungeonTabs();await ceremony('encounter','ENCOUNTER',profile.run.enemyName+' が現れた');}
function enemyChoice(enemy){return G.chooseEnemySpell(enemy,Math.random);}
async function takeTurn(index){
 const run=profile.run;if(playingEffects||!run||run.stage!=='battle')return;
 if(index>=0&&!run.slotIds[index])return;
 const circle=index>=0?circles.find(c=>c.id===run.slotIds[index]):null;
 if(circle?.analysis&&!run.hero.spells[index])run.hero.spells[index]=combatSpell(circle);
 const spell=index>=0?run.hero.spells[index]:null;
 if(index!==-1&&!spell){await analyzeUnknown(index);return;}if(index!==-1&&!G.canCast(run.hero,index)){note('MP不足・再使用待ち・封印のため使用できない');return;}const steps=[];try{run.log.push(...G.round(run.hero,run.enemy,index,enemyChoice(run.enemy),masters.buffs,Math.random,step=>steps.push(step)));}catch(e){note(e.message);return;}
 if(circle?.analysis&&!isRevealed(circle)){
  Object.assign(circle,revealOnUse(circle));rememberCircleMetadata(circle);await persist();
 }
 await animateBattle(steps);
if(run.hero.hp<=0){
  if(profile.permadeath){
   const successor=createSuccessorProfile(profile,run,circles,G.startingBase());
   const lost=successor.legacies.at(-1);
   try{await saveProfile(db,successor);}
   catch(error){note('後継者への引き継ぎ保存に失敗しました：'+String(error?.message||error));throw error;}
   profile=successor;
   for(const circle of lost.circles)circleImages.forget(circle.id,circle.image);
   const removed=new Set(lost.circles.map(circle=>circle.id));
   circles=circles.filter(circle=>!removed.has(circle.id));
   slots=prepareCircles(profile.slots,circles.map(circle=>circle.id),num('spell_slots'));
   selectedStartLayer=null;
   carry=restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(1));
   render();show('prepare');openNameDialog(true);return;
  }
 const dropped=run.loot.length,unusedCount=run.carry.filter(Boolean).length;profile.inventory.push(...run.carry.filter(Boolean));profile.run=null;selectedStartLayer=null;ensureItemInstances(profile);profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));carry=restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));await persist();$('resultTitle').textContent='探索失敗';narrativeLines('resultText',[
 '未確定報酬 '+dropped+'個と経験値を喪失。',
 '未使用の携行品 '+unusedCount+'個は倉庫へ戻った。',
 '性能が判明した魔法陣は残る。'
]);show('result');return;}
if(run.enemy.hp<=0){const bossEnemyId=isLayerBoss(run.floor)?run.enemy.id:null;
   const firstHundredClear=bossEnemyId==='boss_l100'&&!hasHundredFloorCrown(profile);
  const favoredCollectionIds=masters.enemies.find(enemy=>enemy.id===run.enemy.id)?.favored_collection_ids?.split('|')||[];
  const rewards=G.drops(masters.items,masters.collections,run.enemy.level,Math.random,{layer:layerForFight(run.floor),playerLevel:run.hero.level,
   firstClear:layerForFight(run.floor)>deepestReturnedLayer(profile),bossEnemyId,favoredCollectionIds});
  if(bossEnemyId){profile.defeatedBosses??={};profile.defeatedBosses[bossEnemyId]=true;}
   if(firstHundredClear)renderHeroName(run.hero);
  const badge=rankBadgeDrop(run.floor,run.hero,profile,run.loot);
   if(badge)rewards.push(badge);
   const recovered=reclaimLegacies(profile,run.enemy.id,run);
   run.loot.push(...rewards);
   const dropCount=rewards.length+recovered.length;
   run.xp+=G.fightExperience(run.enemy.level,run.hero.level,layerForFight(run.floor));
   run.log.push(dropCount?'撃破！ '+dropCount+'個を入手（未確定）':'撃破！ 今回の戦利品はなし');
   await ceremony('loot',dropCount?'戦利品の発見':'戦利品なし',dropCount?dropCount+'個 · 未確定':'次の戦いへ',dropCount);
   run.hero.statuses=[];run.hero.cooldowns=run.hero.cooldowns.map(()=>0);G.recoverVictoryMp(run.hero,layerForFight(run.floor));if(isLayerBoss(run.floor)){
 const completed=clearedLayer(run.floor);
 const promptForBoss=completed>0&&completed%10===0&&Number(run.lastMilestoneChoiceLayer)!==completed;
 if(promptForBoss)run.lastMilestoneChoiceLayer=completed;
 if(firstHundredClear)run.creatorCongratulationsPending=true;
 run.checkpointBattleScrollY=window.scrollY??window.pageYOffset??0;
 run.stage='checkpoint';renderCheckpoint();show('checkpoint');await persist();
 if(run.creatorCongratulationsPending)showCreatorCongratulations();
 else if(promptForBoss)showMilestoneChoice({title:completed+'層のボス撃破！',message:completed+'層の階層ボスを倒しました。'});
 return;
}run.floor++;enterFight();renderRun();
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
   return '<article class="return-treasure relic-card discovered" data-rarity="'+esc(row.rarity)+'" style="--reveal-delay:'+(Math.min(i,12)*.07)+'s">'
    +(isNew?'<span class="return-new">NEW</span>':'')
    +'<div class="return-treasure-art relic-art" aria-hidden="true">'+relicSymbolSvg(index,true)+'</div>'
     +'<span class="relic-rarity" aria-label="レア度 '+esc(row.rarity)+'">'+collectionRarityMarks(row.rarity)+'</span>'
    +'<strong>'+esc(row.name)+'</strong>'+(count>1?'<span class="return-count">×'+count+'</span>':'')+'</article>';
  }).join('');
 }else if(kind==='rewards'){
  $('returnRewards').innerHTML=returnFlow.rewards.map((reward,i)=>{
   let symbol,name,count=reward.count;
   if(reward.type==='use'){symbol=itemSymbol(reward.item);name=itemName(reward.item);}
   else if(reward.type==='stone'){symbol='✦';name='魔導石';}
   else if(reward.type==='ink'){symbol='🖋️';name=MAGIC_INK_NAME;}
    else if(reward.type==='legacy'){symbol='🔹';name=reward.name;}
   else{symbol='✧';name=reward.name;}
   const rankLayer=reward.type==='rank'?(Number(reward.layer)||ADVENTURER_RANKS.find(rank=>rankBadgeName(rank.layer)===reward.name)?.layer||0):0;
   const symbolMarkup=reward.type==='rank'
    ?'<span class="return-reward-symbol return-rank-symbol" aria-hidden="true"><span class="adventurer-grade"><strong data-rank="'+rankLayer+'"><span>'+esc(rankTitle(rankLayer))+'</span></strong></span></span>'
    :'<span class="return-reward-symbol" aria-hidden="true">'+symbol+'</span>';
   return '<article class="return-reward" style="--reveal-delay:'+(Math.min(i,12)*.07)+'s">'
    +(reward.isNew||reward.type==='rank'||reward.type==='stone'||reward.type==='ink'?'<span class="return-new">NEW</span>':'')
    +symbolMarkup
    +'<strong>'+esc(name)+'</strong>'
    +(reward.type==='use'?'<span class="return-reward-effect" aria-label="'+esc(itemEffectText(reward.item))+'">'+itemEffectIcons(reward.item)+'</span>':'')
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
function showCreatorCongratulations(){
 const run=profile?.run;
 if(!run?.creatorCongratulationsPending||run.stage!=='checkpoint'||clearedLayer(run.floor)!==100)return;
 const dialog=$('creatorCongratulationsDialog');
 if(!dialog.open)dialog.showModal();
}
async function acknowledgeCreatorCongratulations(){
 const run=profile?.run;
 if(!run?.creatorCongratulationsPending||run.stage!=='checkpoint'||clearedLayer(run.floor)!==100)return;
 run.creatorCongratulationsPending=false;
 try{await persist();}
 catch(error){
  run.creatorCongratulationsPending=true;
  note('祝賀メッセージの保存に失敗しました：'+String(error?.message||error));
  showCreatorCongratulations();
  return;
 }
 showMilestoneChoice({title:'100層のボス撃破！',message:'100層の階層ボスを倒しました。'});
}
function showMilestoneChoice(prompt){
 if(!prompt)return;
 $('milestoneChoiceTitle').textContent=prompt.title;
 $('milestoneChoiceMessage').textContent=prompt.message;
 $('milestoneChoiceDialog').showModal();
}
function showSupportPrompt(prompt){
 if(!prompt||!['home','checkpoint','library'].includes(activeScene))return;
 const generation=++shareImageGeneration;
 shareImageFile=null;
 const data=adventurerShareData(profile),canvas=$('adventurerShareCanvas');
 const selected=selectCardCircle(circles,profile.favoriteCircleId,slots);
 $('supportPromptTitle').textContent=prompt.title;
 $('supportPromptMessage').textContent=prompt.message;
 $('supportXLink').href=adventurerXUrl(data);
 $('supportShareHelp').textContent='冒険者カードを生成しています。Xの投稿には本文が入ります。';
 $('supportNativeShare').hidden=true;
 canvas.hidden=true;
 $('supportSaveImage').disabled=true;
 // Wait for the Japanese glyph subset before rasterizing; saved PNGs must not
 // accidentally capture a fallback font while Yuji Mai is downloading.
 const fontReady=typeof document.fonts?.load==='function'
  ? Promise.resolve().then(()=>document.fonts.load('60px "Yuji Mai"',data.name))
    .catch(error=>{console.warn('Yuji Maiを読み込めませんでした（標準フォントを使用）',error);})
  : Promise.resolve();
 const draw=async artwork=>{
  await fontReady;
  if(generation!==shareImageGeneration)return;
  try{
   paintAdventurerCard(canvas,data,artwork);
   canvas.hidden=false;
   $('supportSaveImage').disabled=false;
   $('supportShareHelp').textContent='Xの投稿には本文が入ります。画像は保存して添付できます。';
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
 };
 if(selected?.image&&typeof Image==='function'){
  // Open synchronously; the preview and saving wait for photo and font readiness.
  $('supportPromptDialog').showModal();
  void circleImages.thumbnail(selected).then(thumb=>{
   if(generation!==shareImageGeneration||!$('supportPromptDialog').open)return;
   const image=new Image(),url=URL.createObjectURL(thumb);
   const cleanup=()=>{image.onload=null;image.onerror=null;image.src='';URL.revokeObjectURL(url);};
   image.onload=()=>{
    if(generation===shareImageGeneration&&$('supportPromptDialog').open)
     void draw({image,attribute:selected.analysis?.attribute}).finally(cleanup);
    else cleanup();
   };
   image.onerror=()=>{cleanup();draw(null);};
   image.src=url;
  }).catch(()=>draw(null));
 }else{
  $('supportPromptDialog').showModal();
  void draw(null);
 }
}
function openAdventurerShare(){
 if($('milestoneChoiceDialog').open)$('milestoneChoiceDialog').close();
 showSupportPrompt({title:'冒険者カード',message:'冒険者名・等級・レベル・最深到達／帰還をシェア'});
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
 showMilestoneChoice(supportPrompt);
}
async function leave(mode='checkpoint'){
 const run=profile.run;
 if(!run||(mode==='escape'?run.stage!=='battle':run.stage!=='checkpoint'))return;
 const found=new Map(),items=new Map(),badges=[];
 const knownItems=new Set(profile.obtainedItemIds);
 let stones=0,inks=0;
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
 const recoveredCards=[],restoredPhotos=[],recoveredItemIds=new Set();
 const applyReward=(item,visible)=>{
  if(item.type==='use'){
   profile.inventory.push(item);if(visible)registerItem(item);else recoveredItemIds.add(item.id);
  }else if(item.type==='stone'){
   profile.magicStones++;if(visible)stones++;
  }else if(item.type==='ink'){
   profile.magicInk=(Number(profile.magicInk)||0)+1;if(visible)inks++;
  }else if(item.type==='collection'){
   const oldCount=Number(profile.collection[item.id]||0);
   profile.collection[item.id]=oldCount+1;
   if(visible){
    const existing=found.get(item.id);
    if(existing)existing.count++;
    else found.set(item.id,{id:item.id,count:1,isNew:oldCount===0});
   }
  }else if(item.type==='rank'&&acquireAdventurerRank(profile,item.layer)&&visible){
   badges.push({type:'rank',layer:item.layer,name:rankBadgeName(item.layer),count:1});
  }
 };
 for(const item of run.loot){
  if(item.type!=='legacy'){applyReward(item,true);continue;}
  const legacy=item.legacy,contents=legacyContents(legacy);
  for(const owned of contents.items){profile.inventory.push(owned);recoveredItemIds.add(owned.id);}
  for(const reward of contents.loot)applyReward(reward,false);
  if(contents.rank)acquireAdventurerRank(profile,contents.rank);
  restoredPhotos.push(...contents.circles);
  const pending=[legacy];
  while(pending.length){
   const recovered=pending.shift();
   recoveredCards.push({type:'legacy',name:recovered.name+'の遺物',count:1,isNew:true});
   pending.unshift(...(recovered.loot||[]).filter(reward=>reward.type==='legacy').map(reward=>reward.legacy));
  }
 }
 const before={level:profile.level,xp:profile.xp};
 G.experience(profile,run.xp);
 const previousDepth=deepestReturnedLayer(profile);
 recordReturnedLayer(profile,mode==='escape'?Math.floor((run.floor-1)/FIGHTS_PER_LAYER)*FIGHTS_PER_LAYER:run.floor);
 const supportPrompt=run.lastMilestoneChoiceLayer?null:supportPromptForReturn(previousDepth,deepestReturnedLayer(profile),badges.length?highestRankLayer(profile):0);
 profile.returns++;
 profile.obtainedItemIds=[...new Set([...knownItems,...[...items.values()].map(({item})=>item.id),...recoveredItemIds])];
 profile.run=null;
 selectedStartLayer=null;
 ensureItemInstances(profile);
 profile.carrySlots=validCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 carry=restoreCarrySlots(profile.carrySlots,profile.inventory,G.capacity(profile.level));
 const rewards=[...recoveredCards,...badges,...(stones?[{type:'stone',count:stones}]:[]),...(inks?[{type:'ink',count:inks}]:[]),...[...items.values()].sort((a,b)=>Number(b.isNew)-Number(a.isNew))];
 const restored=[...new Map(restoredPhotos.map(circle=>[circle.id,circle])).values()].filter(circle=>!circles.some(owned=>owned.id===circle.id));
 // Preserve PR #140's recovery guarantee independently from disposable thumbnails.
 const saveReturn=async()=>{
  // Relic recovery changes ownership and stats, not the registered photo.
  if(restored.length){
   profile.magicOverrides={...(profile.magicOverrides||{})};
   for(const circle of restored){
    const {image,...metadata}=circle;
    profile.magicOverrides[circle.id]=metadata;
   }
  }
  await persist();
  if(!restored.length)return;
  const snapshot=await readDungeonSnapshot(db);
  const recoveredIds=new Set(restored.map(circle=>circle.id));
  const persisted=snapshot.circles.filter(circle=>recoveredIds.has(circle.id));
  if(persisted.length!==recoveredIds.size||persisted.some(circle=>!(circle.image instanceof Blob)||!circle.image.size))
   throw Error('遺物の魔法陣の写真を保存できませんでした。');
  circles=newestCirclesFirst([...circles,...persisted.map(circle=>({...circle,...(profile.magicOverrides?.[circle.id]||{})}))]);
 };
 const steps=[...(found.size?['collections']:[]),...(rewards.length?['rewards']:[]),...(run.xp>0?['xp']:[])];
 if(!steps.length){
  profile.pendingReturn=null;
   await saveReturn();
   render();
  show('home');
  showMilestoneChoice(supportPrompt);
  return;
 }
 returnFlow={steps,step:0,collections:[...found.values()].sort((a,b)=>Number(b.isNew)-Number(a.isNew)),rewards,before,gained:run.xp,supportPrompt};
 profile.pendingReturn=returnFlow;
 await saveReturn();
 render();
 renderReturnStep();
 show('returnShowcase');
}

const ANALYSIS_STAGES={ready:1,'image-ready':2,'analysis-start':3,'spell-reading':3,'structure-ready':4,complete:5};
function resetAnalysisProgress(){
 $('analysisProgress').value=0;
 $('analysisProgress').setAttribute('aria-valuenow','0');
 $('analysisProgressCount').textContent='0/5';
 $('analysisError').textContent='';$('analysisError').hidden=true;
}
function onAnalysisMessage(event){
 const request=activeAnalysis;
 if(!request||event.origin!==location.origin||event.source!==$('analyzerFrame').contentWindow)return;
 const {type,stage,detail}=event.data||{};
 if(type!=='magia-dungeon-analysis')return;
 if(stage==='error'){
  const message=String(detail||'解析処理に失敗しました。');
  $('analysisError').textContent=message;$('analysisError').hidden=false;
  request.fail?.(Error(message));
  return;
 }
 const next=ANALYSIS_STAGES[stage];
 if(!next)return;
 const progress=Math.max(Number($('analysisProgress').value)||0,next);
 $('analysisProgress').value=progress;
 $('analysisProgress').setAttribute('aria-valuenow',String(progress));
 $('analysisProgressCount').textContent=progress+'/5';
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
  if(request){request.cancel=()=>finish(Error('解析が中断されました'));request.fail=error=>finish(error);}
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
    finish(null,(circle.origin==='drawn'?normalizeAnalysisResult:successfulDungeonAnalysis)({
     attribute:doc.querySelector('#attributeResult .altar-value')?.textContent?.trim(),
     role:doc.querySelector('#shapeResult .altar-value')?.textContent?.trim(),
     power:doc.querySelector('#powerResult .altar-value')?.textContent?.trim()
    }));
   }catch(e){finish(e);}
  };
  frame.src='magia-circle.html?dungeon=1';
 });
}

// A failed image reading creates weak magic; canceling or failing to save does not.
async function parseDungeonMagic(circle,valid,request){
 try{return {analysis:await parseCircleImage(circle,$('analyzerFrame'),valid,request),failed:false};}
 catch(error){
  if(!valid())throw error;
  return {analysis:failedDungeonAnalysis(),failed:true};
 }
}
async function analyzeCapturedCircle(circle,useInk=false){
 // Show the full analysis screen. Capture returns to its dialog on cancellation.
 const request={id:circle.id,type:'capture',epoch:photoAnalysisEpoch,origin:circle.origin};
 activeAnalysis=request;
 rememberCameraScroll();
 show('analyzing');
 resetAnalysisProgress();
 note('');
 const valid=()=>activeAnalysis===request&&!profile.run&&request.epoch===photoAnalysisEpoch;
 try{
  const result=await parseDungeonMagic(circle,valid,request);
  if(!valid())return;
  const reduced={...result.analysis,power:circle.origin==='drawn'?drawnPower(result.analysis.power):Math.max(MIN_DUNGEON_POWER,result.analysis.power)};
  if(useInk&&!(profile.magicInk>0))throw Error('魔導のインクが不足しています。');
  const analyzed={...savePreanalysis(circle,useInk?inkEnhancedAnalysis(reduced):reduced),...(useInk?{creationInk:true}:{})};
  // The new circle and ink cost share a single integrity-checked transaction.
  if(useInk){
   await loadoutSaveQueue;
   if(!valid())return;
   const nextProfile={...profile,magicInk:profile.magicInk-1};
   await saveProfileWithCircles(db,nextProfile,[analyzed]);
   profile=nextProfile;
  }else await putCircle(db,analyzed);
  if(!valid())return;
  circles=newestCirclesFirst([...circles,analyzed]);
  if(circle.origin!=='drawn')stopCamera();
  $('useMagicInk').checked=false;
  activeAnalysis=null;
  show('library');
  returnToCameraScroll();
  await revealOriginal(analyzed,result.failed);
 }catch(e){
  if(!valid())return;
  activeAnalysis=null;
  show('library');
  returnToCameraScroll();
  if(circle.origin!=='drawn')openCircleCamera();
  $('cameraError').textContent='解明失敗：'+String(e?.message||e)+'（写真は保存していません）';
  $('cameraError').hidden=false;
 }
}
async function analyzeUnknown(index){
 const run=profile.run,circle=circles.find(x=>x.id===run?.slotIds[index]);
 if(!circle){note('魔法陣が見つからない');return;}
 const request={id:circle.id,index};
 activeAnalysis=request;show('analyzing');resetAnalysisProgress();note('');
 const valid=()=>activeAnalysis===request&&profile.run===run;
 (async()=>{
  try{
   const result=await parseDungeonMagic(circle,valid,request);
   if(!valid())return;
   Object.assign(circle,savePreanalysis(circle,{...result.analysis,power:circle.origin==='drawn'?drawnPower(result.analysis.power):Math.max(MIN_DUNGEON_POWER,result.analysis.power)}));
   if(!valid())return;
   run.hero.spells[index]=combatSpell(circle);
   rememberCircleMetadata(circle);await persist();
   activeAnalysis=null;note('');show('battle');await revealOriginal(circle,result.failed);await takeTurn(index);
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
 $('cameraCapture').disabled=!active;
}
async function openCamera(video){
 if(!navigator.mediaDevices?.getUserMedia)throw Error('HTTPSまたはlocalhostのカメラ対応ブラウザが必要です。');
 const active=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
 video.srcObject=active;
 video.hidden=false;
 try{await video.play();}
 catch(error){active.getTracks().forEach(t=>t.stop());video.srcObject=null;throw error;}
 return active;
}
async function cameraPhotoBlob(video,canvas){
 if(!video.videoWidth)return null;
 const side=Math.min(video.videoWidth,video.videoHeight),max=1280,scale=Math.min(1,max/side);
 canvas.width=Math.round(side*scale);canvas.height=canvas.width;
 canvas.getContext('2d').drawImage(video,(video.videoWidth-side)/2,(video.videoHeight-side)/2,side,side,0,0,canvas.width,canvas.height);
 return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
}
function syncRepairCameraUi(active){
 $('imageRepairPlaceholder').hidden=active;
 $('imageRepairVideo').hidden=!active;
 $('imageRepairStart').hidden=active;
 $('imageRepairCapture').hidden=!active;
}
async function startRepairCamera(){
 if(repairStream){syncRepairCameraUi(true);return;}
 const epoch=++repairCameraEpoch,video=$('imageRepairVideo');
 $('imageRepairStart').disabled=true;
 try{
  const active=await openCamera(video);
  if(epoch!==repairCameraEpoch){
   active.getTracks().forEach(t=>t.stop());
   if(video.srcObject===active)video.srcObject=null;
   return;
  }
  repairStream=active;syncRepairCameraUi(true);$('imageRepairError').textContent='';
 }catch(e){
  if(epoch!==repairCameraEpoch)return;
  syncRepairCameraUi(false);
  $('imageRepairError').textContent='カメラを起動できません：'+e.message;
 }finally{
  if(epoch===repairCameraEpoch)$('imageRepairStart').disabled=false;
 }
}
function stopRepairCamera(){
 repairCameraEpoch++;
 if(repairStream){repairStream.getTracks().forEach(t=>t.stop());repairStream=null;}
 $('imageRepairVideo').srcObject=null;
 $('imageRepairStart').disabled=false;
 syncRepairCameraUi(false);
}
let cameraOpenEpoch=0;
function openCircleCamera(){
 if(profile.run||activeAnalysis)return;
 const dialog=$('circleCameraDialog');
 if(!dialog.open)dialog.showModal();
 void startCamera();
}
async function startCamera(){
 if(stream){syncCameraUi(true);return;}
 const epoch=++cameraOpenEpoch;
 try{
  const opened=await openCamera($('cameraVideo'));
  if(epoch!==cameraOpenEpoch||!$('circleCameraDialog').open){
   opened.getTracks().forEach(t=>t.stop());
   $('cameraVideo').srcObject=null;
   return;
  }
  stream=opened;syncCameraUi(true);note('');
 }catch(e){
  if(epoch!==cameraOpenEpoch)return;
  if(e?.name==='NotAllowedError'||e?.name==='PermissionDeniedError'){
   closeCamera();
   $('cameraError').hidden=true;$('cameraError').textContent='';
   return;
  }
  stopCamera();note('カメラを起動できません：'+e.message);
 }
}
function stopCamera(){
 cameraOpenEpoch++;
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 $('cameraVideo').srcObject=null;syncCameraUi(false);
}
function closeCamera(){
 if($('circleCameraDialog').open)$('circleCameraDialog').close();
 stopCamera();
}
async function capture(){
 if(!stream||!$('circleCameraDialog').open||!$('cameraVideo').videoWidth)return;
 const blob=await cameraPhotoBlob($('cameraVideo'),$('cameraCanvas'));
 if(!blob){note('撮影画像を作成できません');return;}
 if(!stream||!$('circleCameraDialog').open)return;
 lastCaptureRegistration=Math.max(nextCircleRegistration(circles),lastCaptureRegistration+1);
 const original=newCapturedCircle(crypto.randomUUID(),blob,lastCaptureRegistration);
 const circle=profile.permadeath?markCircleCreator(original,profile.name):original;
 // Save only when analysis or its weak fallback has been finalized.
 $('cameraError').hidden=true;$('cameraError').textContent='';
 $('circleCameraDialog').close();
 await analyzeCapturedCircle(circle,$('useMagicInk').checked&&profile.magicInk>0);
}
async function saveDrawnCircle(blob){
 if(profile.run||activeAnalysis)throw Error('探索中・解析中は魔法陣を登録できません。');
 lastCaptureRegistration=Math.max(nextCircleRegistration(circles),lastCaptureRegistration+1);
 const original={...newCapturedCircle(crypto.randomUUID(),blob,lastCaptureRegistration),origin:'drawn'};
 const circle=profile.permadeath?markCircleCreator(original,profile.name):original;
 await analyzeCapturedCircle(circle,$('useMagicInk').checked&&profile.magicInk>0);
}
function oneSentencePerLine(value){return String(value).replace(/([。！？])\s*(?=\S)/gu,'$1\n');}
function openMagicDetails(id){
 const circle=circles.find(c=>c.id===id);if(!circle)return;
 const inheritedLevel=totalLegacyLevel(circle),isRelic=inheritedLevel>0;
 const history=isRelic?circleRelicHistory(circle):null;
 const sources=isRelic?circleLegacyLevelSources(circle):[];
 const relicTitle=$('magicDetailsLegacyTitle');
 relicTitle.hidden=!isRelic;
 relicTitle.textContent=isRelic?(history.originName||'名を失った冒険者')+'の残した遺物':'';
 const previous=circles.find(c=>c.id===$('magicDetailsDialog').dataset.circleId);
 if(previous&&previous.id!==id){$('magicDetailsImage').removeAttribute('src');circleImages.release(previous.image);}
 $('magicDetailsDialog').dataset.circleId=id;
 $('magicDetailsImage').dataset.circlePhotoId=id;
 $('repairSelectedCircleImage').hidden=!failedPhotoIds.has(id)&&circle.image instanceof Blob&&circle.image.size>0;
 $('upgradeFeedback').textContent='';
 const stoneCost=upgradeStoneCost(circle.upgradeLevel??0);
 $('magicStoneStock').textContent='所持魔導石：'+profile.magicStones+'個 / 次の強化：'+stoneCost+'個';
 $('upgradeCircle').hidden=Boolean(profile.run);
 $('upgradeCircle').disabled=Boolean(profile.run)||!isRevealed(circle)||profile.magicStones<stoneCost;
 $('upgradeHint').textContent=!isRevealed(circle)?'威力は初回使用後に強化できます。':profile.magicStones<stoneCost?'次の強化には魔導石が'+stoneCost+'個必要です。':'初期威力の10%分アップします。強化段階に応じて必要な魔導石が増えます。';
 const d=circleDetails(circle,masters.buffs,G.mpCost);
 $('magicDetailsImage').src=circleImages.get(circle.image);
 const info=circleEffectDetails(circle,masters.buffs,G.statusDuration);
 const rows=[['作成方法',circle.origin==='drawn'?'簡易（手書き）':'本格（撮影）'],['属性',d.attribute],['種別',d.role],['効果の詳細',info.effect]];
 if(circle.creationInk)rows.push(['🖋️ 魔導のインク','登録時に基礎威力＋10%（適用済み）']);
 if(info.statusName)rows.push(['追加効果名',info.statusName],['追加効果の詳細',info.statusDescription],['持続時間',info.duration]);
 rows.push(['MP',d.mp],['威力',d.power]);
 if(isRevealed(circle)&&circle.upgradeLevel)rows.push(['強化', '+'+(circle.upgradeLevel*10)+'%']);
 if(isRelic)rows.push(['🔵🔥 継承',(circle.analysis?.role==='support'||circle.analysis?.role==='defense'?'自分の最大HP+':'敵の最大HP-')+inheritedLevel+'（合計Lv.'+inheritedLevel+'）']);
 $('magicDetailsStats').innerHTML=rows.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(oneSentencePerLine(value))+'</dd>').join('')
  +(isRelic?'<dt class="legacy-heirs-label">過去の継承者達</dt><dd class="legacy-heirs-value">'
   +[...new Set([history.originName,...history.heirNames,...sources.map(source=>source.name)].filter(Boolean))]
    .map(name=>{
     const level=sources.find(source=>source.name===name)?.level;
     return '<span class="legacy-heir-name">'+esc(name)+(level?' Lv.'+level:'')+'</span>';
    }).join('')
   +'</dd>':'');
 if(!$('magicDetailsDialog').open)$('magicDetailsDialog').showModal();
}
function askCircleAction(type,id){
 if(profile.run)return;
 const circle=circles.find(c=>c.id===id);
 if(!circle)return;
 if(type==='upgrade'&&(!isRevealed(circle)||profile.magicStones<upgradeStoneCost(circle.upgradeLevel??0)))return;
 pendingCircleAction={type,id};
 $('circleActionTitle').textContent=type==='upgrade'?'魔法陣を強化しますか？':'魔法陣を削除しますか？';
 $('circleActionMessage').textContent=type==='upgrade'
  ?'魔導石を'+upgradeStoneCost(circle.upgradeLevel??0)+'個消費して威力を初期値の10%分アップします。\nこの強化は元に戻せません。'
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
   const stoneCost=upgradeStoneCost(circle.upgradeLevel??0);
   if(!isRevealed(circle)||profile.magicStones<stoneCost)return;
   const enhanced=upgradeCircle(circle);
   // Persist only scalar metadata: rewriting a stored photo Blob can fail on mobile browsers.
   const nextProfile={...profile,magicStones:profile.magicStones-stoneCost,
    circleUpgrades:{...(profile.circleUpgrades||{}),[circle.id]:savedUpgrade(enhanced)}};
   await saveProfile(db,nextProfile);
   profile=nextProfile;
   Object.assign(circle,enhanced);
   render();
   openMagicDetails(circle.id);
   $('upgradeFeedback').textContent='✦ 強化成功！\n威力 '+enhanced.analysis.power+' ✦';
   const dialog=$('magicDetailsDialog');
   dialog.dataset.enhancing='true';
   const epoch=++upgradeRitualEpoch;
   void playCircleUpgrade(circle,$('magicUpgradeEffect')).catch(()=>{});
   setTimeout(()=>{if(epoch===upgradeRitualEpoch)dialog.dataset.enhancing='false';},CIRCLE_RITUAL_DURATION_MS);
  }else if(action.type==='remove'){
   const nextSlots=slots.map(id=>id===circle.id?null:id);
   const nextProfile={...profile,
    slots:[...nextSlots],
    favoriteCircleId:profile.favoriteCircleId===circle.id?null:profile.favoriteCircleId,
    circleUpgrades:Object.fromEntries(Object.entries(profile.circleUpgrades||{}).filter(([id])=>id!==circle.id)),
    magicOverrides:Object.fromEntries(Object.entries(profile.magicOverrides||{}).filter(([id])=>id!==circle.id))};
   await loadoutSaveQueue;
   await saveProfileWithCircles(db,nextProfile,[],[circle.id]);
   profile=nextProfile;
   circleImages.forget(circle.id,circle.image);
   failedPhotoIds.delete(circle.id);
   circles=circles.filter(c=>c.id!==circle.id);
   slots=nextSlots;
   render();
  }
  $('circleActionDialog').close();
  pendingCircleAction=null;
 }catch(e){note('魔法陣の処理に失敗しました：'+e.message);}
}
function renderLoadoutChoices(){
 if(!picker)return;
 $('loadoutOptions').className=picker.kind==='circle'?'picker-grid circle-picker-grid':'picker-grid';
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
 refreshCirclePhotos();
}
function openLoadoutPicker(kind,index){
 if(profile.run)return;
 if(kind==='circle'){
  if(index<0||index>=slots.length)return;
 }else{
  if((profile.returns===0&&!profile.inventory.length)||index<0||index>=G.capacity(profile.level))return;
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
 refreshCirclePhotos();
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
  if(choice!==null&&!circles[choice])return;
  slots=setSlot(slots,index,choice===null?null:circles[choice].id);
  profile.slots=[...slots];
 }else{
  if(choice!==null&&!profile.inventory[choice])return;
  carry=setSlot(carry,index,choice);
  profile.carrySlots=saveCarrySlots(carry,profile.inventory);
 }
 // Update the screen now; commit each selected state in order without locking input.
 closeLoadoutPicker();
 render();
 const revision=++loadoutSaveRevision;
 const snapshot={...profile,slots:[...profile.slots],carrySlots:[...profile.carrySlots]};
 const save=loadoutSaveQueue.then(async()=>{
  try{await saveProfile(db,snapshot);}
  catch(error){
   // A later selection will save its own snapshot; never overwrite its UI.
   if(revision!==loadoutSaveRevision){note('編成の保存に失敗しました：'+String(error?.message||error));return;}
   try{
    const stored=await getProfile(db);
    if(revision!==loadoutSaveRevision)return;
    slots=prepareCircles(stored.slots,circles.map(c=>c.id));
    carry=restoreCarrySlots(stored.carrySlots,profile.inventory,G.capacity(profile.level));
    profile.slots=[...slots];
    profile.carrySlots=saveCarrySlots(carry,profile.inventory);
    render();
   }catch(readError){console.error('保存済みの編成を読み込めませんでした',readError);}
   note('編成の保存に失敗しました：'+String(error?.message||error));
  }
 });
 loadoutSaveQueue=save;
 await save;
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
  // Finish active upload and verification before clearing local data.
  // Unlinking removes the auth cookie and prevents the restore chooser.
  await cloudSyncController?.disconnect?.();
  await clearDungeonData(db);
  await clearLegacyThumbnailCache();
  stopCamera();
  circleImages.releaseAll();
  failedPhotoIds.clear();
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
  openBackupSetup();
 }catch(e){
  $('deleteDataError').textContent='データの削除に失敗しました：'+e.message;
 }
}
function updateGameModeDescription(){
 const permanent=$('permadeathInput').value==='permadeath';
 $('gameModeDescription').textContent=permanent
  ?'冒険者たちの死を乗り越えて後継者がダンジョンへ挑む'
  :'1人の冒険者が何度もダンジョンに挑む';
 $('gameModeWarning').hidden=!permanent;
}
function openNameDialog(required){
 const dialog=$('nameDialog');
 $('playerNameInput').value=profile.name||'';
 $('nameDialogTitle').textContent=profile.awaitingHeir?'後継者':'冒険者の名を刻む';
 $('permadeathChoice').hidden=!required||Boolean(profile.awaitingHeir);
 $('permadeathInput').value=profile.permadeath?'permadeath':'casual';
 updateGameModeDescription();
 $('nameError').textContent='';
 $('cancelNameDialog').hidden=required;
 if(!dialog.open)dialog.showModal();
 $('playerNameInput').focus();
}
async function toggleFavoriteCircle(id){
 if(profile.run||!circles.some(circle=>circle.id===id))return;
 const firstFavorite=!profile.favoriteCircleId&&!profile.favoriteCircleEverSelected;
 const next={...profile,favoriteCircleId:profile.favoriteCircleId===id?null:id,favoriteCircleEverSelected:true};
 await saveProfile(db,next);
 profile=next;
 render();
 if(firstFavorite)openAdventurerShare();
}
function wireFavoriteHold(){
 const grid=$('libraryCards');
 let held=null;
 const cancel=()=>{if(held)clearTimeout(held.timer);held=null;};
 grid.addEventListener('pointerdown',event=>{
  if((event.button!==undefined&&event.button!==0)||event.target.closest('button'))return;
  const card=event.target.closest('[data-circle-id]');
  if(!card||profile.run)return;
  cancel();
  const press={id:card.dataset.circleId,x:event.clientX??0,y:event.clientY??0,timer:null};
  press.timer=setTimeout(()=>{
   if(held!==press)return;
   held=null;
   void exclusive(()=>toggleFavoriteCircle(press.id)).catch(error=>note('お気に入りの保存に失敗しました：'+error.message));
  },550);
  held=press;
 });
 grid.addEventListener('pointermove',event=>{
  if(held&&Math.hypot((event.clientX??0)-held.x,(event.clientY??0)-held.y)>12)cancel();
 });
 for(const kind of ['pointerup','pointercancel','pointerleave'])grid.addEventListener(kind,cancel);
 grid.addEventListener('contextmenu',event=>{
  if(event.target.closest('[data-circle-id]'))event.preventDefault();
 });
 grid.addEventListener('keydown',event=>{
  if(event.key!=='Enter'&&event.key!==' ')return;
  if(!event.target.matches?.('.card img'))return;
  const id=event.target.closest('[data-circle-id]')?.dataset.circleId;
  if(!id)return;
  event.preventDefault();
  void exclusive(()=>toggleFavoriteCircle(id)).catch(error=>note('お気に入りの保存に失敗しました：'+error.message));
 });
}
function wire(){
 syncCameraUi(false);
 drawingEditor=initCircleDrawing(document,{onSave:saveDrawnCircle});
 window.addEventListener('message',onAnalysisMessage);
 document.addEventListener('error',onCirclePhotoError,true);
 document.addEventListener('load',onCirclePhotoLoad,true);
 wireFavoriteHold();
 magicStoneTutorial=initMagicStoneTutorial(document);
 let practiceFromCamera=false;
 tutorial=initCircleTutorial(document,async toCamera=>{
  profile.tutorialDone=true;
  try{await persist();}catch(error){note('チュートリアルの保存に失敗しました：'+error.message);}
  if(toCamera||practiceFromCamera){practiceFromCamera=false;show('library');openCircleCamera();}
 });
 $('tutorialReplay').addEventListener('click',()=>{
  if(!profile.run&&!activeAnalysis){practiceFromCamera=true;closeCamera();tutorial.open();}
 });
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
   closeCamera();show(b.dataset.view);
   if(b.dataset.view==='library'&&shouldShowMagicStoneTutorial(profile)){
    profile.magicStoneTutorialSeen=true;
    magicStoneTutorial.open();
    void persist().catch(()=>{});
   }
   return;
 }
 if(b.dataset.action==='rename'){openNameDialog(false);return;}
 if(b.dataset.action==='delete-data'){openDeleteDataDialog();return;}
 if(b.dataset.circleDetail){openMagicDetails(b.dataset.circleDetail);return;}
 if(b.dataset.remove){askCircleAction('remove',b.dataset.remove);return;}
 if(b.dataset.upgrade){askCircleAction('upgrade',b.dataset.upgrade);return;}
 if(b.dataset.openSlot!==undefined){openLoadoutPicker('circle',Number(b.dataset.openSlot));return;}
 if(b.dataset.openItem!==undefined){openLoadoutPicker('item',Number(b.dataset.openItem));return;}
 if(b.dataset.chooseCircle!==undefined){await chooseLoadout(Number(b.dataset.chooseCircle));return;}
 if(b.dataset.chooseItem!==undefined){await chooseLoadout(Number(b.dataset.chooseItem));return;}
 if(b.dataset.cast!==undefined){await battleAction('cast',Number(b.dataset.cast));return;}
 if(b.dataset.use!==undefined){await battleAction('use',Number(b.dataset.use));return;}
 });
 $('permadeathInput').addEventListener('change',updateGameModeDescription);
 $('nameForm').addEventListener('submit',async event=>{
   event.preventDefault();
   // Naming cannot be blocked by a battle action still finishing its animation.
   if(savingName)return;
   const name=$('playerNameInput').value.trim();
   if(!name||name.length>20){$('nameError').textContent='1〜20文字で入力してください';return;}
   if(isDungeonNameBlocked(name)){$('nameError').textContent='この名前は使用できません。別の名前を入力してください';return;}
   const firstLesson=!profile.tutorialDone&&!circles.length&&!profile.attempts&&!profile.run;
   const button=$('savePlayerName');
   savingName=true;
   button.disabled=true;
   $('nameError').textContent='保存中…';
   let saved=false;
   try{
    let next;
    if(profile.awaitingHeir){
     // The original photos are already safely stored. Do not rewrite them.
     next=await saveHeirName(db,name);
    }else{
     next={...profile,name,awaitingHeir:false,
      permadeath:!profile.name?$('permadeathInput').value==='permadeath':Boolean(profile.permadeath)};
     await saveProfile(db,next);
    }
    profile=next;
    $('nameDialog').close();
    render();
    saved=true;
    void cloudSyncController?.syncNow?.()?.catch?.(error=>console.error('名前のクラウド同期に失敗しました',error));
   }catch(error){
    console.error('冒険者名の保存に失敗しました',error);
    $('nameError').textContent='名前を保存できませんでした：'+String(error?.message||error);
     note('冒険者名の保存に失敗しました：'+String(error?.message||error));
   }finally{
    savingName=false;
    button.disabled=false;
   }
   if(saved&&firstLesson)tutorial.open();
 });
 $('closeSaveError').addEventListener('click',()=>$('saveErrorDialog').close());
  $('cancelNameDialog').addEventListener('click',()=>$('nameDialog').close());
 $('nameDialog').addEventListener('cancel',event=>{if(!profile.name)event.preventDefault();});
 $('deleteDataPhrase').addEventListener('input',()=>{
  $('confirmDeleteData').disabled=$('deleteDataPhrase').value.trim()!=='削除';
 });
 $('cancelDeleteData').addEventListener('click',()=>$('deleteDataDialog').close());
 $('confirmDeleteData').addEventListener('click',()=>exclusive(eraseSaveData));
 $('setupWithoutBackup').addEventListener('click',()=>{void (async()=>{
  await cloudSyncController?.disconnect?.();
  finishBackupSetup();
 })();});
 $('repairMagicCirclePhotos').addEventListener('click',()=>{void exclusive(async()=>{
  const health=await refreshRepairStatus();
  if(health.status==='badImages')await recaptureMissingImages(health.badImageIds);
  await refreshRepairStatus();
 }).catch(error=>note('写真の修復に失敗しました：'+error.message));});
 $('backupSetupDialog').addEventListener('cancel',event=>event.preventDefault());
 $('closeMagicDetails').addEventListener('click',()=>$('magicDetailsDialog').close());
 $('magicDetailsDialog').addEventListener('close',()=>{
  const circle=circles.find(c=>c.id===$('magicDetailsDialog').dataset.circleId);
  $('magicDetailsImage').removeAttribute('src');
  if(circle)circleImages.release(circle.image);
 });
 $('repairSelectedCircleImage').addEventListener('click',()=>exclusive(async()=>{
  if(profile.run)return;
  const id=$('magicDetailsDialog').dataset.circleId;
  if(!circles.some(c=>c.id===id))return;
  if($('magicDetailsDialog').open)$('magicDetailsDialog').close();
  if(await recaptureMissingImages([id]))openMagicDetails(id);
 }).catch(error=>note('写真の復旧に失敗しました：'+error.message)));
 $('upgradeCircle').addEventListener('click',()=>askCircleAction('upgrade',$('magicDetailsDialog').dataset.circleId));
 $('cancelCircleAction').addEventListener('click',()=>{$('circleActionDialog').close();pendingCircleAction=null;});
 $('circleActionDialog').addEventListener('close',()=>{pendingCircleAction=null;});
 $('confirmCircleAction').addEventListener('click',()=>exclusive(confirmCircleAction));
 $('closeLoadoutDialog').addEventListener('click',closeLoadoutPicker);
 $('openGrimoireFromPicker').addEventListener('click',()=>{closeLoadoutPicker();show('library');});
 $('clearLoadoutSlot').addEventListener('click',()=>chooseLoadout(null));
 $('loadoutDialog').addEventListener('close',()=>{if(!$('loadoutDialog').open)picker=null;refreshCirclePhotos();});
 $('openCircleDrawing').addEventListener('click',()=>{if(!profile.run&&!activeAnalysis){closeCamera();drawingEditor.open();}});
 $('openCircleCamera').addEventListener('click',openCircleCamera);
 $('cameraStop').addEventListener('click',closeCamera);
 $('circleCameraDialog').addEventListener('cancel',event=>{event.preventDefault();closeCamera();});
 $('cameraCapture').addEventListener('click',()=>exclusive(capture));
 $('startAttack').addEventListener('click',()=>exclusive(begin));$('returnHome').addEventListener('click',()=>exclusive(leave));
  $('returnNext').addEventListener('click',()=>exclusive(advanceReturnStep));
  $('openAdventurerShare').addEventListener('click',openAdventurerShare);
  $('creatorCongratulationsClose').addEventListener('click',()=>{
   const dialog=$('creatorCongratulationsDialog');
   if(dialog.open)dialog.close();
   return acknowledgeCreatorCongratulations();
  });
  $('creatorCongratulationsDialog').addEventListener('close',()=>acknowledgeCreatorCongratulations());
  $('milestoneShare').addEventListener('click',openAdventurerShare);
  $('milestoneDonate').addEventListener('click',()=>$('milestoneChoiceDialog').close());
  $('milestoneClose').addEventListener('click',()=>$('milestoneChoiceDialog').close());
  $('supportPromptClose').addEventListener('click',()=>$('supportPromptDialog').close());
  $('supportXLink').addEventListener('click',()=>$('supportPromptDialog').close());
 $('supportPromptDialog').addEventListener('close',()=>{shareImageGeneration++;shareImageFile=null;});
  $('supportSaveImage').addEventListener('click',downloadAdventurerCard);
  $('supportNativeShare').addEventListener('click',shareAdventurerCardImage);
 for(const choice of ['restore','collection','item'])$('bonus-'+choice)?.addEventListener('click',()=>exclusive(()=>claimBonus(choice)));
 $('deeper').addEventListener('click',()=>exclusive(async()=>{const run=profile.run;if(!run||run.stage!=='checkpoint')return;const previousScroll=run.checkpointBattleScrollY;delete run.checkpointBattleScrollY;run.floor++;run.bonusClaimed=false;enterFight();await persist();renderRun();show('battle');restoreContinuedBattleScroll(previousScroll);await ceremony('encounter','ENCOUNTER',run.enemyName+' が現れた');}));
 $('cancelAnalyze').addEventListener('click',()=>{
  const request=activeAnalysis,capture=request?.type==='capture';
  const drawn=capture&&request.origin==='drawn';
  activeAnalysis=null;
  request?.cancel?.();
  if(capture)photoAnalysisEpoch++;
  $('analyzerFrame').onload=null;
  $('analyzerFrame').src='about:blank';
  note('');
  if(drawn){
   cameraReturnScroll=null;
   show('library');
   drawingEditor.resume();
  }else if(capture){show('library');returnToCameraScroll();openCircleCamera();}
  else {renderRun();show('battle');}
 });
 window.addEventListener('beforeunload',()=>{stopCamera();stopRepairCamera();circleImages.releaseAll();});
}
load().catch(failStartup);
