import * as G from './dungeon-core.mjs';
import {configure,num,floor as floorMaster} from './dungeon-tuning.mjs';
import {openStore,allCircles,putCircle,deleteCircle,saveProfile,getProfile} from './dungeon-store.mjs';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,circles=[],masters={},slots=[],carry=[],stream=null,activeAnalysis=null,urls=[];
function note(message){$('notice').textContent=message;}
async function persist(){await saveProfile(db,profile);}
async function load(){db=await openStore();const files={enemies:'dungeon-enemies.csv',items:'dungeon-consumables.csv',collections:'dungeon-collections.csv',buffs:'dungeon-buffs.csv',balance:'dungeon-balance.csv',levels:'dungeon-levels.csv',floors:'dungeon-floors.csv',playerBase:'dungeon-player-base.csv'};for(const [key,file] of Object.entries(files)){const res=await fetch('assets/data/'+file);if(!res.ok)throw Error(file+' の取得に失敗');masters[key]=G.parseCsv(await res.text());}configure(masters);G.validateMasters(masters.enemies,masters.items,masters.collections,masters.buffs);profile=await getProfile(db);circles=await allCircles();slots=profile.slots||[];carry=[];wire();render();if(profile.run){if(profile.run.stage==='checkpoint'){$('checkpointInfo').textContent='未確定報酬 '+profile.run.loot.length+'個 / 経験値 '+profile.run.xp;}else renderRun();}show(profile.run?(profile.run.stage==='checkpoint'?'checkpoint':'battle'):'home');}
function show(name){for(const id of ['home','library','prepare','battle','checkpoint','analyzing','result'])$(id).hidden=id!==name;if(name==='home'||name==='library'||name==='prepare')render();}
function imageUrl(blob){const url=URL.createObjectURL(blob);urls.push(url);return url;}
function freeUrls(){for(const url of urls)URL.revokeObjectURL(url);urls=[];}
function statusText(unit){return unit.statuses.map(s=>{const row=masters.buffs.find(x=>x.id===s.id);const label=row?.name||(s.id.startsWith('resist_')?s.attribute+'耐性':'強化');return esc(label)+'('+s.turns+')';}).join(' / ');}
function rowUnit(unit){const hp=Math.max(0,100*unit.hp/unit.stats.hp),mp=Math.max(0,100*unit.mp/unit.maxMp);return '<p>HP '+unit.hp+'/'+unit.stats.hp+'</p><div class="meter"><div class="fill" style="width:'+hp+'%"></div></div><p>MP '+unit.mp+'/'+unit.maxMp+'</p><div class="meter"><div class="fill mp" style="width:'+mp+'%"></div></div><small>MAG '+unit.stats.mag+' / DEF '+G.armor(unit)+' / RES '+unit.stats.res+'</small>'+(unit.statuses.length?'<p class="effects">'+statusText(unit)+'</p>':'');}
const roles={attack:'⚔ 攻撃',defense:'🛡 防御',support:'✚ 回復',debuff:'🕸 弱体'};
function circleLabel(a){return esc(a.attribute+' / '+(roles[a.role]||a.role)+' / 威力 '+a.power);}
function itemName(item){return masters.items.find(x=>x.id===item.id)?.name||item.id;}
function render(){$('resumeTab').hidden=!profile.run;freeUrls();const s=G.stats(profile.base,profile.level);$('playerStats').innerHTML='<p>Lv.'+profile.level+'　経験値 '+profile.xp+'/'+G.nextXp(profile.level)+'</p><p>HP '+s.hp+'　MAG '+s.mag+'　DEF '+s.def+'　RES '+s.res+'</p><p>持ち込み上限：'+G.capacity(profile.level)+' 個　帰還：'+profile.returns+'回　最高踏破：'+profile.highest+'戦</p>';
$('collectionList').innerHTML='<details><summary>図鑑 '+Object.keys(profile.collection).length+'/'+masters.collections.length+'</summary>'+masters.collections.map(x=>'<p>'+esc(x.name)+'：'+(profile.collection[x.id]||0)+'</p>').join('')+'</details>';
$('libraryCards').innerHTML=circles.map(c=>'<article class="card"><img alt="魔法陣" src="'+imageUrl(c.image)+'"><b>'+esc(c.name)+'</b><p>'+(c.analysis?circleLabel(c.analysis):'未鑑定・？？？')+'</p><div class="card-actions"><button class="subtle" data-remove="'+c.id+'" '+(profile.run?'disabled':'')+'>削除</button></div></article>').join('')||'<p>まだ魔法陣がありません。カメラで5つ登録してください。</p>';
$('slotCards').innerHTML='<div class="cards">'+circles.map(c=>'<article class="card '+(slots.includes(c.id)?'selected':'')+'"><img alt="魔法陣" src="'+imageUrl(c.image)+'"><b>'+esc(c.name)+'</b><p>'+(c.analysis?esc(c.analysis.attribute+' / '+(roles[c.analysis.role]||c.analysis.role)):'？？？')+'</p><button data-slot="'+c.id+'">'+(slots.includes(c.id)?'外す':'編成')+'</button></article>').join('')+'</div><p>'+slots.length+'/5 枠</p>';
const unlocked=profile.returns>0,limit=G.capacity(profile.level);$('gearCards').innerHTML=unlocked?profile.inventory.map((x,i)=>'<div class="inventory-row"><span>'+esc(itemName(x))+' '+(x.value?'回復 '+x.value:'')+(x.bonus?' ✨追加バフ':'')+'</span><button data-gear="'+i+'" class="'+(carry.includes(i)?'selected':'subtle')+'">'+(carry.includes(i)?'外す':'持ち込む')+'</button></div>').join('')||'<p>使用可能なポーションなし</p>':'<p>最初の帰還成功後に解放されます。</p>';
$('gearCounter').textContent='携行 '+(unlocked?carry.length:0)+' / '+limit+' 個';$('startAttack').disabled=slots.length!==num('spell_slots')||Boolean(profile.run);}
function renderRun(){const run=profile.run;if(!run)return;const enemy=run.enemy,hero=run.hero;$('floorLabel').textContent='第'+run.floor+'戦'+(run.floor%num('checkpoint_interval')===0?' / 階層の番人':'');$('enemyName').textContent=run.enemyName+' Lv.'+enemy.level;$('enemyStats').innerHTML=rowUnit(enemy);$('heroStats').innerHTML=rowUnit(hero);
$('battleSpells').innerHTML=run.slotIds.map((id,i)=>{const c=circles.find(x=>x.id===id),s=hero.spells[i];return '<div class="card"><b>'+esc(c?.name||'魔法陣')+'</b><p>'+(s?circleLabel(s):'初回発動で鑑定')+'</p><button data-cast="'+i+'" '+(run.itemPending||s&&!G.canCast(hero,i)?'disabled':'')+'>発動</button><p>再使用待ち '+(hero.cooldowns[i]||0)+'</p></div>';}).join('')+'<div class="card"><b>通常攻撃</b><p>MP不要の最低限の攻撃</p><button data-cast="-1">通常攻撃</button></div>';
$('battleItems').innerHTML=run.carry.map((it,i)=>'<div class="inventory-row"><span>'+esc(itemName(it))+' '+(it.value?'('+it.value+')':'')+(it.bonus?' ✨':'')+'</span><button data-use="'+i+'" '+((run.usedItems||0)>=num('item_per_round')?'disabled':'')+'>使用</button></div>').join('')||'<p>携行品なし</p>';
$('battleInfo').textContent='未確定報酬 '+run.loot.length+'個 / 未確定経験値 '+run.xp+' / アイテム無料使用 '+((run.usedItems||0)+'/'+num('item_per_round'));$('battleLog').innerHTML=run.log.slice(-15).map(x=>'<p>'+esc(x)+'</p>').join('');}
function createEnemy(floor){const rowFloor=floorMaster(floor),level=Number(rowFloor.enemy_level);const pool=masters.enemies.filter(x=>Number(x.min_level)<=level&&Number(x.min_level)>=Number(rowFloor.minimum_enemy_level)&&x.boss_only!=='1');let row;if(Number(rowFloor.boss)===1){row=masters.enemies.find(x=>x.id===rowFloor.boss_enemy_id);if(!row||Number(row.min_level)>level)throw Error('ボスの設定が不正');}else row=G.weighted(pool);return {unit:G.fromEnemy(row,level),name:row.name};}
function enterFight(){const run=profile.run,{unit,name}=createEnemy(run.floor);run.enemy=unit;run.enemyName=name;run.usedItems=0;run.stage='battle';run.log.push('第'+run.floor+'戦：'+name+'が現れた');}
async function begin(){if(profile.run||slots.length!==num('spell_slots')){note('5つの魔法陣を編成してください');return;}const selected=carry.map(i=>profile.inventory[i]);for(const i of [...carry].sort((a,b)=>b-a))profile.inventory.splice(i,1);const hero=G.makeUnit(profile.base,profile.level,{},slots.map(id=>{const a=circles.find(c=>c.id===id)?.analysis;return a?{...a}:null;}),'player');profile.slots=[...slots];profile.run={floor:1,slotIds:[...slots],hero,enemy:null,carry:selected,loot:[],xp:0,usedItems:0,log:[],stage:'battle'};profile.attempts++;enterFight();carry=[];await persist();renderRun();show('battle');}
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
async function startCamera(){if(!navigator.mediaDevices?.getUserMedia){note('HTTPSまたはlocalhostのカメラ対応ブラウザが必要です。');return;}try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});$('cameraVideo').srcObject=stream;await $('cameraVideo').play();$('cameraPane').hidden=false;note('魔法陣が映るようにカメラを向けて撮影してください。');}catch(e){note('カメラを起動できません：'+e.message);}}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('cameraVideo').srcObject=null;$('cameraPane').hidden=true;}
async function capture(){if(!stream||!$('cameraVideo').videoWidth)return;const v=$('cameraVideo'),canvas=$('cameraCanvas'),side=Math.min(v.videoWidth,v.videoHeight),max=1280,scale=Math.min(1,max/side);canvas.width=Math.round(side*scale);canvas.height=canvas.width;canvas.getContext('2d').drawImage(v,(v.videoWidth-side)/2,(v.videoHeight-side)/2,side,side,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob){note('撮影画像を作成できません');return;}const circle={id:crypto.randomUUID(),name:$('circleName').value.trim()||'無名の魔法陣',image:blob,analysis:null};await putCircle(db,circle);circles.push(circle);$('circleName').value='';stopCamera();note('魔法陣を保存した。性能は初回使用時に判明する。');render();}
function wire(){
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.view){stopCamera();show(b.dataset.view);return;}
 if(b.dataset.remove){if(profile.run)return;await deleteCircle(db,b.dataset.remove);circles=circles.filter(c=>c.id!==b.dataset.remove);slots=slots.filter(id=>id!==b.dataset.remove);profile.slots=[...slots];await persist();render();return;}
 if(b.dataset.slot){const id=b.dataset.slot;slots=slots.includes(id)?slots.filter(x=>x!==id):slots.length<num('spell_slots')?[...slots,id]:slots;profile.slots=[...slots];await persist();render();return;}
 if(b.dataset.gear!==undefined){if(profile.returns===0)return;const i=Number(b.dataset.gear),at=carry.indexOf(i);if(at>=0)carry.splice(at,1);else if(carry.length<G.capacity(profile.level))carry.push(i);else note('持ち込み上限です');render();return;}
 if(b.dataset.cast!==undefined){await takeTurn(Number(b.dataset.cast));return;}
 if(b.dataset.use!==undefined){await useItem(Number(b.dataset.use));return;}
 });
 $('cameraStart').addEventListener('click',startCamera);$('cameraStop').addEventListener('click',stopCamera);$('cameraCapture').addEventListener('click',capture);
 $('startAttack').addEventListener('click',begin);$('returnHome').addEventListener('click',leave);
 $('deeper').addEventListener('click',async()=>{const run=profile.run;if(!run||run.stage!=='checkpoint')return;run.floor++;enterFight();await persist();renderRun();show('battle');});
 $('cancelAnalyze').addEventListener('click',()=>{activeAnalysis=null;$('analyzerFrame').src='about:blank';note('鑑定を中止しました。');renderRun();show('battle');});
 window.addEventListener('beforeunload',()=>{stopCamera();freeUrls();});
}
load().catch(e=>{console.error(e);note('起動できません：'+e.message);});
