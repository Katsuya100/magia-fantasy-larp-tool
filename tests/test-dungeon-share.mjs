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
 fillText(...args){drawTexts.push(args[0]);drawOps.push(['fillText',...args]);}};
const canvas={width:0,height:0,getContext:()=>ctx};
assert.equal(paintAdventurerCard(canvas,data),canvas);
assert.deepEqual([canvas.width,canvas.height],[1200,675]);
assert.ok(drawTexts.includes('鉛級')&&drawTexts.includes('Lv.21')&&drawTexts.includes('10層'));
assert.ok(drawTexts.includes(profile.name),'Canvas shows the player name on their own card');
assert.ok(drawTexts.includes('👑'),'Canvas puts the earned crown next to the name');
const nameLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='冒険者名');
const rankLabel=drawOps.find(([kind,text])=>kind==='fillText'&&text==='冒険者等級');
const namePaint=drawOps.find(([kind,text])=>kind==='fillText'&&text===profile.name);
const crownPaint=drawOps.find(([kind,text])=>kind==='fillText'&&text==='👑');
const rankPaint=drawOps.find(([kind,text])=>kind==='fillText'&&text===data.rank);
assert.ok(nameLabel&&rankLabel&&nameLabel[2]<rankLabel[2],'name label is left of grade label');
assert.ok(namePaint&&rankPaint&&namePaint[2]<rankPaint[2],'player name sits to the LEFT of the grade');
assert.ok(namePaint[3]>260&&namePaint[3]<366,'name sits in the new name panel, not in the footer');
assert.ok(crownPaint&&crownPaint[2]>namePaint[2]&&crownPaint[2]<rankPaint[2],'crown stays beside the name on the left');
assert.equal(crownPaint[3],namePaint[3],'name and crown share the baseline');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===82&&y===260&&w===248&&h===106),'dedicated name panel is drawn');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===342&&y===260&&w===346&&h===106),'rank panel is shifted right');
assert.ok(!drawOps.some(([kind,text,x,y])=>kind==='fillText'&&text===profile.name&&y>548),'footer no longer carries the name');
assert.ok(drawTexts.includes('12層')&&drawTexts.includes('10層'),'both deep records appear on card');
assert.ok(drawOps.some(([kind])=>kind==='strokeRect'),'card has decorative border');
assert.ok(stops.length>=4,'card has gradients');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).light),'card text uses same metallic gradient as profile');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).deep),'card plate uses profile rank metal');
assert.equal(rankMetalPalette(100).mid,'#f0bf75','highest rank keeps special metallic tone');

// Maximum-length Japanese name must wrap inside its left-side panel without
// colliding with the 100-layer rank plaque; place the crown after the final line.
const longestName='あいうえおかきくけこさしすせそたちつてと';
const longPaint=[];
const measuredCtx={...ctx,
 measureText(text){
  const fontSize=Number(this.font?.match(/(\d+)px/)?.[1])||26;
  return {width:[...text].length*fontSize};
 },
 fillText(...args){longPaint.push({text:args[0],x:args[1],y:args[2],maxWidth:args[3],font:this.font});}
};
paintAdventurerCard({getContext:()=>measuredCtx}, {...data,name:longestName,rank:'オリハルコン級',rankLayer:100});
const nameLines=longPaint.filter(({x,y})=>x===96&&y>260&&y<366);
assert.ok(nameLines.length>=2&&nameLines.length<=3,'long Japanese name wraps over at most three rows');
assert.equal(nameLines.map(x=>x.text).join(''),longestName,'every character of a long name remains present');
assert.ok(nameLines.every(line=>line.x>=94&&line.x<330&&line.y<366),'all name lines remain inside left panel');
assert.ok(nameLines.every(line=>measuredCtx.measureText.call({font:line.font},line.text).width<=186),'name rows fit beside crown');
const longCrown=longPaint.find(x=>x.text==='👑'),longRank=longPaint.find(x=>x.text==='オリハルコン級');
assert.ok(longCrown&&longCrown.x>96&&longCrown.x<330,'crown follows long name inside left panel');
assert.equal(longCrown.y,nameLines.at(-1).y,'crown is beside the last name line');
assert.ok(longRank&&longRank.x===362&&longRank.maxWidth===306,'longest rank stays in the right plaque');
assert.ok(!longPaint.some(({text,y})=>text===longestName&&y>548),'long name is not placed in footer');

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
