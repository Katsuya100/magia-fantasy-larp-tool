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

const profile={name:'秘密の冒険者名',level:21,adventurerRank:10,deepestReturnedLayer:10};
const data=adventurerShareData(profile);
assert.deepEqual(data,{rank:'鉛級',rankLayer:10,level:21,deepest:10});
const text=adventurerShareText(data);
assert.equal(text,'マギアサークル-ダンジョンアタック\n冒険者等級：鉛級\nLv.21\n最深帰還：10層');
assert.ok(!text.includes(profile.name),"never share the player name");
const url=new URL(adventurerXUrl(data));
assert.equal(url.hostname,'x.com');
assert.equal(url.pathname,'/intent/tweet');
assert.equal(url.searchParams.get('text'),text);
assert.equal(url.searchParams.get('url'),DUNGEON_SHARE_URL);
assert.deepEqual(adventurerShareData({level:0}),{rank:'未取得',rankLayer:0,level:1,deepest:0});
assert.match(adventurerShareText(adventurerShareData({})),/最深帰還：未到達/);

const drawTexts=[],stops=[],drawOps=[];
const gradient=()=>({addColorStop(offset,color){stops.push([offset,color]);}});
const ctx={createLinearGradient:gradient,createRadialGradient:gradient,
 fillRect(...args){drawOps.push(['fillRect',...args]);},
 strokeRect(...args){drawOps.push(['strokeRect',...args]);},
 beginPath(){},arc(){},moveTo(){},lineTo(){},closePath(){},stroke(){},
 fillText(...args){drawTexts.push(args[0]);}};
const canvas={width:0,height:0,getContext:()=>ctx};
assert.equal(paintAdventurerCard(canvas,data),canvas);
assert.deepEqual([canvas.width,canvas.height],[1200,675]);
assert.ok(drawTexts.includes('鉛級')&&drawTexts.includes('Lv.21')&&drawTexts.includes('10層'));
assert.ok(!drawTexts.includes(profile.name),'Canvas excludes identifying character name');
assert.ok(drawOps.some(([kind])=>kind==='strokeRect'),'card has decorative border');
assert.ok(stops.length>=4,'card has gradients');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).light),'card text uses same metallic gradient as profile');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).deep),'card plate uses profile rank metal');
assert.equal(rankMetalPalette(100).mid,'#f0bf75','highest rank keeps special metallic tone');

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const profileHtml=html.slice(html.indexOf('<section id="home"'),html.indexOf('<section id="library"'));
assert.ok(profileHtml.indexOf('id="openAdventurerShare"')<profileHtml.indexOf('id="deleteSaveData"'),'share and support appear above delete');
assert.ok(profileHtml.indexOf('id="openAdventurerShare"')<profileHtml.indexOf('href="https://ofuse.me/2429ddee"'),'share is ordered before support');
assert.ok(profileHtml.indexOf('href="https://ofuse.me/2429ddee"')<profileHtml.indexOf('id="deleteSaveData"'),'donation is also above delete');
assert.ok(profileHtml.includes('class="profile-support"'),'share and OFUSE share a two-column action group');
assert.equal((profileHtml.match(/class="profile-action"/g)||[]).length,2,'both actions have equivalent button styling');
assert.equal((html.match(/id="openAdventurerShare"/g)||[]).length,1);
assert.ok(html.includes('id="supportXLink"')&&html.includes('id="supportDonateLink"'),'same milestone modal exposes both equal-weight links');
assert.ok(html.includes('id="adventurerShareCanvas"'),'card is previewed inside the shared modal');
assert.ok(!html.includes('id="tab-share"'),'no new navigation screen');

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
 assert.equal($('supportOptionalNote').hidden,true,'ordinary share dialog does not mention donation pressure');
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

console.log('PASS local Canvas card, private progress values, X intent, profile button, save and native image share');
