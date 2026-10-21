import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adventurerShareData,adventurerShareText,adventurerXUrl,paintAdventurerCard,DUNGEON_SHARE_URL} from '../assets/js/dungeon-share.mjs';
import {rankMetalPalette} from '../assets/js/dungeon-ranks.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});

const profile={name:'秘密の冒険者名',level:21,adventurerRank:10,deepestReachedLayer:12,deepestReturnedLayer:10,defeatedBosses:{boss_l100:true}};
const data=adventurerShareData(profile);
assert.deepEqual(data,{rank:'鉛級',rankLayer:10,level:21,name:profile.name,crowned:true,deepestReached:12,deepestReturned:10});
const text=adventurerShareText(data);
assert.equal(text,'マギアサークル-ダンジョンアタック\n冒険者等級：鉛級\nLv.21\n最深到達階層：12層\n最深帰還階層：10層');
assert.ok(!text.includes(profile.name),"never share the player name");
const url=new URL(adventurerXUrl(data));
assert.equal(url.hostname,'x.com');
assert.equal(url.pathname,'/intent/tweet');
assert.equal(url.searchParams.get('text'),text);
assert.equal(url.searchParams.get('url'),DUNGEON_SHARE_URL);
assert.deepEqual(adventurerShareData({level:0}),{rank:'未取得',rankLayer:0,level:1,name:'名もなき冒険者',crowned:false,deepestReached:0,deepestReturned:0});
assert.match(adventurerShareText(adventurerShareData({})),/最深帰還階層：未到達/);

const drawTexts=[],stops=[],drawOps=[];
const gradient=()=>({addColorStop(offset,color){stops.push([offset,color]);}});
const ctx={createLinearGradient:gradient,createRadialGradient:gradient,
 fillRect(...args){drawOps.push(['fillRect',...args]);},
 strokeRect(...args){drawOps.push(['strokeRect',...args]);},
 beginPath(){},arc(){},moveTo(){},lineTo(){},closePath(){},stroke(){},
 save(){drawOps.push(['save']);},restore(){drawOps.push(['restore']);},
 translate(...args){drawOps.push(['translate',...args]);},
 scale(...args){drawOps.push(['scale',...args]);},
 fillText(...args){drawTexts.push(args[0]);drawOps.push(['fillText',...args,this.font]);}};
const canvas={width:0,height:0,getContext:()=>ctx};
assert.equal(paintAdventurerCard(canvas,data),canvas);
assert.deepEqual([canvas.width,canvas.height],[1200,675]);
assert.ok(drawTexts.includes('鉛級')&&drawTexts.includes('Lv.21')&&drawTexts.includes('10層'));
assert.ok(drawTexts.includes(profile.name),'Canvas shows the player name on their own card');
assert.ok(drawTexts.includes('👑'),'Canvas puts the earned crown next to the name');
const nameLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='冒険者名');
const levelLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='LEVEL');
const rankLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='冒険者等級');
const reachedLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='最深到達階層');
const returnedLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='最深帰還階層');
const namePaint=drawOps.find(([kind,text])=>kind==='fillText'&&text===profile.name);
const crownPaint=drawOps.find(([kind,text])=>kind==='fillText'&&text==='👑');
const levelPaint=drawOps.find(([kind,text])=>kind==='fillText'&&text==='Lv.21');
const rankPaint=drawOps.find(([kind,text])=>kind==='fillText'&&text===data.rank);
assert.ok(nameLabel&&levelLabel&&rankLabel&&reachedLabel&&returnedLabel);
assert.ok(nameLabel[2]<levelLabel[2]&&nameLabel[3]===levelLabel[3],'first row: name on left, level on right');
assert.ok(rankLabel[2]<reachedLabel[2]&&reachedLabel[2]<returnedLabel[2],'second row: rank, reached and returned');
assert.ok(rankLabel[3]>nameLabel[3],'second row is below the name and level');
assert.ok(namePaint&&levelPaint&&namePaint[3]===levelPaint[3]&&namePaint[2]<levelPaint[2],'large name and level share first row');
assert.ok(rankPaint&&rankPaint[3]>namePaint[3],'grade belongs to second row');
assert.ok(crownPaint&&crownPaint[2]>namePaint[2]&&crownPaint[2]<levelPaint[2],'crown stays immediately to the right of name');
assert.equal(crownPaint[3],namePaint[3],'name and crown share the baseline');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===82&&y===250&&w===420&&h===101),'wider upper name plate is drawn');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===514&&y===250&&w===174&&h===101),'level plate is beside name');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===82&&y===397&&w===258&&h===104),'rank moves to second row');
assert.ok(!drawOps.some(([kind,text,x,y])=>kind==='fillText'&&text===profile.name&&y>548),'name is not in footer');
assert.ok(drawTexts.includes('12層')&&drawTexts.includes('10層'),'both deep records appear on card');
assert.ok(drawOps.some(([kind])=>kind==='strokeRect'),'card has decorative border');
assert.ok(stops.length>=4,'card has gradients');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).light),'card text uses same metallic gradient as profile');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).deep),'card plate uses profile rank metal');
assert.equal(rankMetalPalette(100).mid,'#f0bf75','highest rank keeps special metallic tone');

// A real Canvas transforms text horizontally to stretch short names while
// making full-length names fit on one line at a much larger font size.
const longestName='あいうえおかきくけこさしすせそたちつてと';
const renderFor=(name,crowned=true)=>{
 const paints=[],scales=[],translations=[];
 const sample={...ctx,
  measureText(text){
   const size=Number(this.font?.match(/(\\d+)px/)?.[1])||50;
   return {width:[...text].length*size};
  },
  save(){paints.push({kind:'save'});},
  translate(x,y){translations.push([x,y]);paints.push({kind:'translate',x,y});},
  scale(x,y){scales.push([x,y]);paints.push({kind:'scale',x,y});},
  restore(){paints.push({kind:'restore'});},
  fillText(text,x,y,maxWidth){paints.push({kind:'text',text,x,y,maxWidth,font:this.font});}
 };
 paintAdventurerCard({getContext:()=>sample},{...data,name,crowned,rank:'オリハルコン級',rankLayer:100});
 return {paints,scales,translations};
};
const short=renderFor('勇者');
const shortName=short.paints.find(op=>op.kind==='text'&&op.text==='勇者');
assert.ok(shortName&&shortName.font==='800 50px sans-serif','short name is drawn in large 50px text');
assert.ok(short.scales.some(([x,y])=>x>1&&y===1),'short names are stretched horizontally');
assert.ok(short.translations.some(([x,y])=>x===98&&y===321),'name is transformed inside upper-left plate');
const long=renderFor(longestName);
const longName=long.paints.filter(op=>op.kind==='text'&&op.text===longestName);
assert.equal(longName.length,1,'20-character name stays on one line');
assert.equal(longName[0].font,'800 34px sans-serif','long name retains legible 34px height');
assert.ok(long.scales.some(([x,y])=>x<1&&y===1),'long names compress horizontally to fit');
assert.ok(long.paints.some(op=>op.kind==='text'&&op.text==='👑'&&op.x>98&&op.x<502&&op.y===321),
 'crown follows stretched long name inside upper-left plate');
assert.ok(long.paints.some(op=>op.kind==='text'&&op.text==='オリハルコン級'&&op.y===466),
 'longest rank remains in second row');
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const profileHtml=html.slice(html.indexOf('<section id="home"'),html.indexOf('<section id="library"'));
assert.ok(profileHtml.indexOf('id="openAdventurerShare"')<profileHtml.indexOf('id="deleteSaveData"'),'share and support appear above delete');
assert.ok(profileHtml.indexOf('id="openAdventurerShare"')<profileHtml.indexOf('href="https://ofuse.me/2429ddee"'),'share is ordered before support');
assert.ok(profileHtml.indexOf('href="https://ofuse.me/2429ddee"')<profileHtml.indexOf('id="deleteSaveData"'),'donation is also above delete');
assert.ok(profileHtml.includes('class="profile-support" aria-label='),'share and OFUSE share a two-column action group');
assert.equal((profileHtml.match(/class="profile-action"/g)||[]).length,2,'both actions have equivalent button styling');
assert.equal((html.match(/id="openAdventurerShare"/g)||[]).length,1);
assert.ok(html.includes('id="supportXLink"'),'card dialog retains X sharing');
assert.ok(!html.includes('id="supportDonateLink"')&&!html.includes('id="supportOptionalNote"'),'card dialog omits donation link and optional donation note');
assert.ok(html.includes('id="adventurerShareCanvas"'),'card is previewed inside the shared modal');
assert.ok(!html.includes('id="tab-share"'),'no new navigation screen');

const modalHtml=html.slice(html.indexOf('<dialog id="supportPromptDialog"'),html.indexOf('<dialog id="deleteDataDialog"'));
const shareRow=modalHtml.match(/<div class="support-prompt-actions">([\s\S]*?)<\/div>/)?.[1]||'';
const xAction=shareRow.match(/<a id="supportXLink" class="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
const imageAction=shareRow.match(/<button type="button" id="supportNativeShare" class="([^"]+)" hidden>([\s\S]*?)<\/button>/);
assert.ok(xAction&&imageAction,'X and image share actions are in the same row');
assert.ok(shareRow.indexOf('id="supportXLink"')<shareRow.indexOf('id="supportNativeShare"'),'image share is immediately right of X');
assert.equal(xAction[1],imageAction[1],'X and image share use matching button design');
assert.ok(xAction[2].startsWith('Xでシェア '),'X sharing label is unchanged');
assert.ok(imageAction[2].startsWith('画像付きでシェア '),'image sharing label is explicit');
assert.match(xAction[2],/class="share-mark"[^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg>$/,'X button ends with share icon');
assert.match(imageAction[2],/class="share-mark"[^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg>$/,'image button ends with the same share icon');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
assert.match(css,/\.support-prompt-actions \.support-share-action\{/,'share actions have one shared style');
assert.match(css,/\.support-prompt-actions \.support-share-action\[hidden\]\{display:none\}/,'native share stays hidden on unsupported browsers');
assert.ok(!modalHtml.slice(modalHtml.indexOf('<div class="support-card-tools">')).includes('id="supportNativeShare"'),'image share no longer lives among save/close controls');


const factory=fakeIndexedDB(),db=await openStore(factory),p=await getProfile(db);
Object.assign(p,profile,{tutorialDone:true});
await saveProfile(db,p);
const env=fakeDungeonBrowser({factory,nativeShare:true}),$=id=>env.document.getElementById(id);
const wait=async check=>{
 const deadline=Date.now()+9000;
 while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(check(),'dungeon loaded');
};
try{
 await import('../assets/js/dungeon-app.mjs?integration=adventurer-share');
 await wait(()=>$('startupMask').hidden===true);
 assert.equal($('supportPromptDialog').open,false,'no unsolicited share popup');
 await env.document.click({disabled:false,dataset:{view:'home'},closest(){return this;}});
 assert.equal($('home').hidden,false,'profile is visible before user opens the share dialog');
 await $('openAdventurerShare').fire('click');
 assert.equal($('supportPromptDialog').open,true,'profile opens the same milestone modal');
 assert.equal($('supportPromptTitle').textContent,'冒険者カード');
 assert.ok(!html.includes('id="supportDonateLink"'),'ordinary card dialog contains no donation action');
 assert.equal($('adventurerShareCanvas').hidden,false);
 assert.equal($('adventurerShareCanvas').width,1200);
 const openUrl=new URL($('supportXLink').href);
 assert.equal(openUrl.searchParams.get('text'),text);
 assert.equal(openUrl.searchParams.get('url'),DUNGEON_SHARE_URL);
 await $('supportSaveImage').fire('click');
 assert.deepEqual(env.downloads,[{href:'data:image/png;base64,ZmFrZQ==',download:'magia-adventurer-card.png'}]);
 if(typeof File!=='undefined'){
  assert.equal($('supportNativeShare').hidden,false,'native image share enabled when browser supports it');
  await $('supportNativeShare').fire('click');
  assert.equal(env.nativeShares.length,1);
  assert.equal(env.nativeShares[0].files[0].type,'image/png');
  assert.match(env.nativeShares[0].text,/Lv\.21/);
 }
 await $('supportPromptClose').fire('click');
 assert.equal($('supportPromptDialog').open,false,'share remains optional');
}finally{env.restore();}

console.log('PASS local Canvas card with name/crown, two depth records, private X text and native image share');
