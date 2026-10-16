import * as G from './dungeon-core.mjs?v=20261017.2';
import {prepareCircles,prepareItems,setSlot,pickedValues,isFull} from './dungeon-loadout.mjs?v=20261017.2';
import {spellGrid,itemGrid,circleChoices,itemChoices} from './dungeon-preparation-ui.mjs?v=20261017.2';
import {configure,num,floor as floorMaster} from './dungeon-tuning.mjs';
import {openStore,allCircles,putCircle,deleteCircle,saveProfile,getProfile} from './dungeon-store.mjs?v=20261017.2';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,circles=[],masters={},slots=[],carry=[],stream=null,activeAnalysis=null,urls=[],picker=null;
let busyAction=false;
async function exclusive(fn){if(busyAction)return;busyAction=true;try{return await fn();}finally{busyAction=false;}}
function note(message){$('notice').textContent=message;}
async function persist(){await saveProfile(db,profile);}
async function load(){db=await openStore();const files={enemies:'dungeon-enemies.csv',items:'dungeon-consumables.csv',collections:'dungeon-collections.csv',buffs:'dungeon-buffs.csv',balance:'dungeon-balance.csv',levels:'dungeon-levels.csv',floors:'dungeon-floors.csv',playerBase:'dungeon-player-base.csv'};for(const [key,file] of Object.entries(files)){const res=await fetch('assets/data/'+file);if(!res.ok)throw Error(file+' の取得に失敗');masters[key]=G.parseCsv(await res.text());}configure(masters);G.validateMasters(masters.enemies,masters.items,masters.collections,masters.buffs);profile=await getProfile(db);circles=await allCircles(db);slots=prepareCircles(profile.slots,circles.map(c=>c.id),num('spell_slots'));carry=prepareItems([],profile.inventory.length,G.capacity(profile.level));wire();render();if(profile.run){if(profile.run.stage==='checkpoint'){$('checkpointInfo').textContent='未確定報酬 '+profile.run.loot.length+'個 / 経験値 '+profile.run.xp;}else renderRun();}show(profile.run?(profile.run.stage==='checkpoint'?'checkpoint':'battle'):'prepare');if(!profile.name)openNameDialog(true);}
function show(name){for(const id of ['home','library','prepare','collection','battle','checkpoint','analyzing','result'])$(id).hidden=id!==name;for(const tab of ['home','library','prepare','collection']){const btn=$('tab-'+tab);if(btn){if(name===tab)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');}}const active=$('resumeTab');if(name==='battle'&&profile.run)active.setAttribute('aria-current','page');else active.removeAttribute('aria-current');if(['home','library','prepare','collection'].includes(name))render();}
function imageUrl(blob){const url=URL.createObjectURL(blob);urls.push(url);return url;}
function freeUrls(){for(const url of urls)URL.revokeObjectURL(url);urls=[];}
function statusText(unit){return unit.statuses.map(s=>{const row=masters.buffs.find(x=>x.id===s.id);const label=row?.name||(s.id.startsWith('resist_')?s.attribute+'耐性':'強化');return esc(label)+'('+s.turns+')';}).join(' / ');}
function rowUnit(unit){const hp=Math.max(0,100*unit.hp/unit.stats.hp),mp=Math.max(0,100*unit.mp/unit.maxMp);return '<p>HP '+unit.hp+'/'+unit.stats.hp+'</p><div class="meter"><div class="fill" style="width:'+hp+'%"></div></div><p>MP '+unit.mp+'/'+unit.maxMp+'</p><div class="meter"><div class="fill mp" style="width:'+mp+'%"></div></div><small>MAG '+unit.stats.mag+' / DEF '+G.armor(unit)+' / RES '+unit.stats.res+'</small>'+(unit.statuses.length?'<p class="effects">'+statusText(unit)+'</p>':'');}
const roles={attack:'⚔ 攻撃',defense:'🛡 防御',support:'✚ 回復',debuff:'🕸 弱体'};
function circleLabel(a){return esc(a.attribute+' / '+(roles[a.role]||a.role)+' / 威力 '+a.power);}
function itemName(item){return masters.items.find(x=>x.id===item.id)?.name||item.id;}
function render(){
 carry=prepareItems(carry,profile.inventory.length,G.capacity(profile.level));
 $('resumeTab').hidden=!profile.run;
 freeUrls();
 const s=G.stats(profile.base,profile.level),experienceNeeded=G.nextXp(profile.level),xpProgress=Math.min(100,100*profile.xp/experienceNeeded);
 const name=esc(profile.name||'名もなき冒険者');
 $('playerStats').innerHTML='<div class="character-name-row"><h3 class="character-name">'+name+'</h3><button class="subtle" data-action="rename">名前変更</button></div>'
 +'<div class="level-line"><strong>Lv.'+profile.level+'</strong><span>EXP '+profile.xp+' / '+experienceNeeded+'</span></div><div class="xp-track" role="progressbar" aria-label="経験値" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(xpProgress)+'"><div class="xp-fill" style="width:'+xpProgress+'%"></div></div>'
 +'<div class="stat-grid">'+['hp','mag','def','res'].map(k=>'<div class="stat-cell"><small>'+k.toUpperCase()+'</small><strong>'+s[k]+'</strong></div>').join('')+'</div>'
 +'<p class="adventure-record">持ち込み上限：'+G.capacity(profile.level)+'個 ｜ 帰還 '+profile.returns+' ｜ 最深 '+profile.highest+'戦</p>';
 const obtained=masters.collections.filter(item=>Number(profile.collection[item.id]||0)>0).length;
 $('collectionProgress').innerHTML='<strong>'+obtained+' / '+masters.collections.length+'</strong><small>DISCOVERED</small><div class="collection-track"><div class="collection-fill" style="width:'+(100*obtained/masters.collections.length)+'%"></div></div>';
 const relics=['✥','◈','☷','✧','⬟','◉','⌘','ϟ','❖','⚿','☯','♛'];
 $('collectionGrid').innerHTML=masters.collections.map((item,i)=>{
  const count=Number(profile.collection[item.id]||0),found=count>0;
  const rarity=['common','uncommon','rare','epic','legendary'].includes(item.rarity)?item.rarity:'common';
  const mark=found?(relics[i%relics.length]):'?';
  return '<article class="relic-card '+(found?'discovered':'locked')+'" data-rarity="'+(found?rarity:'unknown')+'" role="listitem" aria-label="'+(found?esc(item.name):'未発見の収集品')+'">'
   +(found?'<span class="relic-count">×'+count+'</span>':'')
   +'<div class="relic-art" aria-hidden="true"><span class="relic-glyph">'+mark+'</span></div>'
   +'<div class="relic-name">'+(found?esc(item.name):'？？？')+'</div>'
   +'<p class="relic-detail">'+(found?esc(item.description):'未発見')+'</p></article>';
 }).join('');
 $('libraryCards').innerHTML=circles.map(c=>'<article class="card"><img alt="魔法陣" src="'+imageUrl(c.image)+'"><b>'+esc(c.name)+'</b><p>'+(c.analysis?circleLabel(c.analysis):'？？？ · 未鑑定')+'</p><div class="card-actions"><button class="subtle" data-remove="'+c.id+'" '+(profile.run?'disabled':'')+'>削除</button></div></article>').join('')||'<p class="collection-empty">魔導書はまだ白紙。</p>';
 $('slotCards').innerHTML=spellGrid(slots,circles,imageUrl,esc,!profile.run);
 const unlocked=profile.returns>0,limit=G.capacity(profile.level);
 $('gearCards').innerHTML=itemGrid(carry,profile.inventory,limit,unlocked,itemName,esc,!profile.run);
 $('gearCounter').textContent='携行 '+pickedValues(carry).length+' / '+limit+' 個'+(unlocked?'':' · 最初の帰還後に解放');
 $('startAttack').disabled=!isFull(slots)||Boolean(profile.run);
}
function renderRun(){const run=profile.run;if(!run)return;const enemy=run.enemy,hero=run.hero;$('floorLabel').textContent='第'+run.floor+'戦'+(run.floor%num('checkpoint_interval')===0?' / 階層の番人':'');$('enemyName').textContent=run.enemyName+' Lv.'+enemy.level;$('enemyStats').innerHTML=rowUnit(enemy);$('heroStats').innerHTML=rowUnit(hero);
$('battleSpells').innerHTML=run.slotIds.map((id,i)=>{const c=circles.find(x=>x.id===id),s=hero.spells[i];return '<div class="card"><b>'+esc(c?.name||'魔法陣')+'</b><p>'+(s?circleLabel(s):'初回発動で鑑定')+'</p><button data-cast="'+i+'" '+(run.itemPending||s&&!G.canCast(hero,i)?'disabled':'')+'>発動</button><p>再使用待ち '+(hero.cooldowns[i]||0)+'</p></div>';}).join('')+'<div class="card"><b>通常攻撃</b><p>MP不要の最低限の攻撃</p><button data-cast="-1">通常攻撃</button></div>';
$('battleItems').innerHTML=run.carry.map((it,i)=>'<div class="inventory-row"><span>'+esc(itemName(it))+' '+(it.value?'('+it.value+')':'')+(it.bonus?' ✨':'')+'</span><button data-use="'+i+'" '+((run.usedItems||0)>=num('item_per_round')?'disabled':'')+'>使用</button></div>').join('')||'<p>携行品なし</p>';
$('battleInfo').textContent='未確定報酬 '+run.loot.length+'個 / 未確定経験値 '+run.xp+' / アイテム無料使用 '+((run.usedItems||0)+'/'+num('item_per_round'));$('battleLog').innerHTML=run.log.slice(-15).map(x=>'<p>'+esc(x)+'</p>').join('');}
function createEnemy(floor){const rowFloor=floorMaster(floor),level=Number(rowFloor.enemy_level);const pool=masters.enemies.filter(x=>Number(x.min_level)<=level&&Number(x.min_level)>=Number(rowFloor.minimum_enemy_level)&&x.boss_only!=='1');let row;if(Number(rowFloor.boss)===1){row=masters.enemies.find(x=>x.id===rowFloor.boss_enemy_id);if(!row||Number(row.min_level)>level)throw Error('ボスの設定が不正');}else row=G.weighted(pool);return {unit:G.fromEnemy(row,level),name:row.name};}
function enterFight(){const run=profile.run,{unit,name}=createEnemy(run.floor);run.enemy=unit;run.enemyName=name;run.usedItems=0;run.stage='battle';run.log.push('第'+run.floor+'戦：'+name+'が現れた');}
async function begin(){if(profile.run||!isFull(slots)){note('5つの魔法陣を編成してください');return;}const selectedIndices=pickedValues(carry);const selected=selectedIndices.map(i=>profile.inventory[i]);for(const i of [...selectedIndices].sort((a,b)=>b-a))profile.inventory.splice(i,1);const hero=G.makeUnit(profile.base,profile.level,{},slots.map(id=>{const a=circles.find(c=>c.id===id)?.analysis;return a?{...a}:null;}),'player');profile.slots=[...slots];profile.run={floor:1,slotIds:[...slots],hero,enemy:null,carry:selected,loot:[],xp:0,usedItems:0,log:[],stage:'battle'};profile.attempts++;enterFight();carry=prepareItems([],profile.inventory.length,G.capacity(profile.level));await persist();renderRun();show('battle');}
function enemyChoice(enemy){const ids=G.available(enemy);if(!ids.length)return -1;const heal=ids.find(i=>enemy.spells[i].role==='support');if(enemy.hp<enemy.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;const offense=ids.filter(i=>enemy.spells[i].role==='attack');return offense.length&&Math.random()<num('enemy_attack_preference')?offense[Math.floor(Math.random()*offense.length)]:ids[Math.floor(Math.random()*ids.length)];}
async function takeTurn(index){const run=profile.run;if(!run||run.stage!=='battle')return;const spell=run.hero.spells[index];if(index!==-1&&!spell){await analyzeUnknown(index);return;}if(index!==-1&&!G.canCast(run.hero,index)){note('MP不足・再使用待ち・封印のため使用できない');return;}try{run.log.push(...G.round(run.hero,run.enemy,index,enemyChoice(run.enemy),masters.buffs));}catch(e){note(e.message);return;}run.usedItems=0;
if(run.hero.hp<=0){const dropped=run.loot.length,carry=run.carry.length;profile.inventory.push(...run.carry);profile.run=null;await persist();$('resultTitle').textContent='探索失敗';$('resultText').textContent='未確定報酬 '+dropped+'個と経験値を喪失。未使用の携行品 '+carry+'個は倉庫へ戻った。鑑定済みの魔法陣は残る。';show('result');return;}
if(run.enemy.hp<=0){const rewards=G.drops(masters.items,masters.collections,run.enemy.level);run.loot.push(...rewards);run.xp+=num('xp_base')+num('xp_per_level')*run.enemy.level;run.log.push('撃破！ '+rewards.length+'個を入手（未確定）');run.hero.statuses=[];run.hero.cooldowns=run.hero.cooldowns.map(()=>0);profile.highest=Math.max(profile.highest,run.floor);if(run.floor%num('checkpoint_interval')===0){run.stage='checkpoint';$('checkpointInfo').textContent='第'+run.floor+'戦突破。未確定報酬 '+run.loot.length+'個 / 経験値 '+run.xp+'。続行して敗北すると失われる。';await persist();show('checkpoint');return;}run.floor++;enterFight();}
await persist();renderRun();}
async function useItem(index){const run=profile.run;if(!run||(run.usedItems||0)>=num('item_per_round'))return;const [item]=run.carry.splice(index,1);if(!item)return;try{const n=G.potion(run.hero,item,masters.items,masters.buffs);run.log.push(itemName(item)+'を使用 '+(n?'('+n+')':''));run.usedItems=(run.usedItems||0)+1;await persist();renderRun();}catch(e){run.carry.splice(index,0,item);note(e.message);}}
async function leave(){const run=profile.run;if(!run||run.stage!=='checkpoint')return;let potions=0,collection=0;profile.inventory.push(...run.carry);for(const item of run.loot){if(item.type==='use'){profile.inventory.push(item);potions++;}else{profile.collection[item.id]=(profile.collection[item.id]||0)+1;collection++;}}const before=profile.level;G.experience(profile,run.xp);profile.returns++;profile.run=null;await persist();$('resultTitle').textContent='無事帰還！';$('resultText').textContent='消耗品 '+potions+'個・収集品 '+collection+'個・経験値 '+run.xp+'を獲得。Lv.'+before+' → Lv.'+profile.level+'。次回の持ち込み上限 '+G.capacity(profile.level)+'個。';show('result');}
async function waitUntil(check,valid,maxMs=150000){const end=Date.now()+maxMs;while(Date.now()<end){if(!valid())throw Error('鑑定が中断されました');const value=check();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('解析が完了しませんでした。カメラと通信環境を確認してください');}
async function analyzeUnknown(index){
 const circle=circles.find(x=>x.id===profile.run.slotIds[index]);if(!circle){note('魔法陣が見つからない');return;}
 const request={id:circle.id,index};activeAnalysis=request;show('analyzing');note('未鑑定の魔法陣を解析中');
 const frame=$('analyzerFrame');
 frame.onload=async()=>{
  try{
   const valid=()=>activeAnalysis===request;
   const doc=frame.contentDocument;
   const input=await waitUntil(()=>{const el=doc?.getElementById('fileInput');return el&&!el.disabled?el:null;},valid);
   const transfer=new DataTransfer();transfer.items.add(new File([circle.image],'circle.jpg',{type:circle.image.type||'image/jpeg'}));
   input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
   const analyze=await waitUntil(()=>{const el=doc.getElementById('analyzeButton');return el&&!el.disabled?el:null;},valid);
   analyze.click();
   await waitUntil(()=>!doc.getElementById('altarSection')?.hidden,valid);
   const attribute=doc.querySelector('#attributeResult .altar-value')?.textContent?.trim();
   const japaneseRole=doc.querySelector('#shapeResult .altar-value')?.textContent?.trim();
   const power=Number(doc.querySelector('#powerResult .altar-value')?.textContent?.trim());
   const role=({'攻撃':'attack','防御':'defense','回復':'support','弱体':'debuff'})[japaneseRole];
   if(!G.ATTRS.includes(attribute)||!G.ROLES.includes(role)||!Number.isFinite(power)||power<=0)throw Error('有効な相・紋・威力を取得できませんでした');
   circle.analysis={attribute,role,power};
   await putCircle(db,circle);
   if(!valid())return;
   profile.run.hero.spells[index]={...circle.analysis};await persist();
   activeAnalysis=null;frame.onload=null;frame.src='about:blank';note('鑑定完了：'+attribute+' / '+japaneseRole+' / 威力 '+power);
   show('battle');await takeTurn(index);
  }catch(e){if(activeAnalysis!==request)return;activeAnalysis=null;frame.onload=null;frame.src='about:blank';note('鑑定できませんでした：'+e.message);renderRun();show('battle');}
 };
 frame.src='magia-circle.html';
}
async function startCamera(){if(stream){$('cameraPane').hidden=false;return;}if(!navigator.mediaDevices?.getUserMedia){note('HTTPSまたはlocalhostのカメラ対応ブラウザが必要です。');return;}try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});$('cameraVideo').srcObject=stream;await $('cameraVideo').play();$('cameraPane').hidden=false;note('魔法陣が映るようにカメラを向けて撮影してください。');}catch(e){note('カメラを起動できません：'+e.message);}}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('cameraVideo').srcObject=null;$('cameraPane').hidden=true;}
async function capture(){if(!stream||!$('cameraVideo').videoWidth)return;const v=$('cameraVideo'),canvas=$('cameraCanvas'),side=Math.min(v.videoWidth,v.videoHeight),max=1280,scale=Math.min(1,max/side);canvas.width=Math.round(side*scale);canvas.height=canvas.width;canvas.getContext('2d').drawImage(v,(v.videoWidth-side)/2,(v.videoHeight-side)/2,side,side,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob){note('撮影画像を作成できません');return;}const circle={id:crypto.randomUUID(),name:$('circleName').value.trim()||'無名の魔法陣',image:blob,analysis:null};await putCircle(db,circle);circles.push(circle);$('circleName').value='';note('');render();}
function openLoadoutPicker(kind,index){
 if(profile.run)return;
 if(kind==='circle'){
  if(index<0||index>=slots.length)return;
 }else{
  if(profile.returns===0||index<0||index>=G.capacity(profile.level))return;
 }
 picker={kind,index};
 const dialog=$('loadoutDialog');
 $('loadoutDialogTitle').textContent=kind==='circle'?'魔法陣を選ぶ':'持ち込みアイテムを選ぶ';
 $('loadoutOptions').innerHTML=kind==='circle'
  ?circleChoices(circles,slots,imageUrl,esc)
  :itemChoices(profile.inventory,carry,itemName,esc);
 $('clearLoadoutSlot').hidden=kind==='circle'?slots[index]===null:carry[index]===null;
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
 }
 closeLoadoutPicker();
 render();
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
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.view){stopCamera();show(b.dataset.view);return;}
 if(b.dataset.action==='rename'){openNameDialog(false);return;}
 if(b.dataset.remove){if(profile.run)return;await deleteCircle(db,b.dataset.remove);circles=circles.filter(c=>c.id!==b.dataset.remove);slots=slots.map(id=>id===b.dataset.remove?null:id);profile.slots=[...slots];await persist();render();return;}
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
   await exclusive(async()=>{profile.name=name;await persist();$('nameDialog').close();render();});
 });
 $('cancelNameDialog').addEventListener('click',()=>$('nameDialog').close());
 $('nameDialog').addEventListener('cancel',event=>{if(!profile.name)event.preventDefault();});
 $('closeLoadoutDialog').addEventListener('click',closeLoadoutPicker);
 $('clearLoadoutSlot').addEventListener('click',()=>exclusive(()=>chooseLoadout(null)));
 $('loadoutDialog').addEventListener('close',()=>{picker=null;});
 $('cameraStart').addEventListener('click',()=>exclusive(startCamera));$('cameraStop').addEventListener('click',stopCamera);$('cameraCapture').addEventListener('click',()=>exclusive(capture));
 $('startAttack').addEventListener('click',()=>exclusive(begin));$('returnHome').addEventListener('click',()=>exclusive(leave));
 $('deeper').addEventListener('click',()=>exclusive(async()=>{const run=profile.run;if(!run||run.stage!=='checkpoint')return;run.floor++;enterFight();await persist();renderRun();show('battle');}));
 $('cancelAnalyze').addEventListener('click',()=>{activeAnalysis=null;$('analyzerFrame').src='about:blank';note('鑑定を中止しました。');renderRun();show('battle');});
 window.addEventListener('beforeunload',()=>{stopCamera();freeUrls();});
}
load().catch(e=>{console.error(e);note('起動できません：'+e.message);});
