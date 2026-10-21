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
 fillText(...args){drawTexts.push(args[0]);drawOps.push(['fillText',...args,this.font,this.textAlign]);}};
const canvas={width:0,height:0,getContext:()=>ctx};
assert.equal(paintAdventurerCard(canvas,data),canvas);
assert.deepEqual([canvas.width,canvas.height],[1200,675]);
assert.ok(drawTexts.includes('鉛級')&&drawTexts.includes('21')&&drawTexts.includes('10層'));
assert.ok(!drawTexts.includes('Lv.21'),'the level uses only digits, without Lv.');
assert.ok(drawTexts.includes(profile.name),'Canvas shows the player name on their own card');
assert.ok(drawTexts.includes('👑'),'Canvas puts the earned crown next to the name');
const findText=value=>drawOps.find(([kind,text])=>kind==='fillText'&&text===value);
const nameLabel=findText('冒険者名');
const levelLabel=findText('LEVEL');
const rankLabel=findText('冒険者等級');
const reachedLabel=findText('最深到達階層');
const returnedLabel=findText('最深帰還階層');
const namePaint=findText(profile.name);
const crownPaint=findText('👑');
const levelPaint=findText('21');
const rankPaint=findText(data.rank);
const reachedPaint=findText('12層');
const returnedPaint=findText('10層');
assert.ok(nameLabel&&levelLabel&&rankLabel&&reachedLabel&&returnedLabel);
assert.equal(nameLabel[2],82+9,'name heading remains left-aligned');
assert.equal(levelLabel[2],514+9,'LEVEL heading remains left-aligned');
assert.equal(rankLabel[2],82+9,'rank heading remains left-aligned');
assert.equal(reachedLabel[2],352+9,'reached heading remains left-aligned');
assert.equal(returnedLabel[2],522+9,'returned heading remains left-aligned');
assert.ok([nameLabel,levelLabel,rankLabel,reachedLabel,returnedLabel].every(label=>label.at(-1)==='start'),
 'all headings use normal left-aligned lettering');
assert.ok(nameLabel[2]<levelLabel[2]&&nameLabel[3]===levelLabel[3],'first row: name on left, level on right');
assert.ok(rankLabel[2]<reachedLabel[2]&&reachedLabel[2]<returnedLabel[2],'second row: rank, reached and returned');
assert.ok(rankLabel[3]>nameLabel[3],'second row is below the name and level');
assert.ok(namePaint&&namePaint[2]>=82+16&&namePaint[3]===325,'the name is painted in the upper panel');
assert.ok(levelPaint&&levelPaint[2]===601&&levelPaint[3]===326&&levelPaint.at(-1)==='center',
 'the bare level number is centered in its panel');
assert.ok(rankPaint&&rankPaint[2]===211&&rankPaint[3]===467&&rankPaint.at(-1)==='center',
 'grade is horizontally centered in its panel');
assert.ok(reachedPaint&&reachedPaint[2]===431&&reachedPaint[3]===467&&reachedPaint.at(-1)==='center',
 'deepest reached is horizontally centered');
assert.ok(returnedPaint&&returnedPaint[2]===605&&returnedPaint[3]===467&&returnedPaint.at(-1)==='center',
 'deepest returned is horizontally centered');
assert.ok(crownPaint&&crownPaint[2]>namePaint[2]&&crownPaint[2]<levelPaint[2],
 'crown stays to the right of the name on the same row');
assert.equal(crownPaint[3],namePaint[3],'name and crown share the baseline');
assert.ok(!drawOps.some(([kind])=>kind==='scale'||kind==='translate'),'the name must never be stretched along one axis');
assert.ok(drawOps.filter(([kind])=>kind==='fillText').every(op=>op.length===6),
 'fillText must never receive maxWidth, which can squeeze glyphs horizontally');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===82&&y===250&&w===420&&h===101),'wider upper name plate is drawn');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===514&&y===250&&w===174&&h===101),'level plate is beside name');
assert.ok(drawOps.some(([kind,x,y,w,h])=>kind==='fillRect'&&x===82&&y===397&&w===258&&h===104),'rank remains in second row');
assert.ok(!drawOps.some(([kind,text,x,y])=>kind==='fillText'&&text===profile.name&&y>548),'name is not in footer');
assert.ok(drawTexts.includes('12層')&&drawTexts.includes('10層'),'both deep records appear on card');
assert.ok(drawOps.some(([kind])=>kind==='strokeRect'),'card has decorative border');
assert.ok(stops.length>=4,'card has gradients');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).light),'card text uses same metallic gradient as profile');
assert.ok(stops.some(([,color])=>color===rankMetalPalette(10).deep),'card plate uses profile rank metal');
assert.equal(rankMetalPalette(100).mid,'#f0bf75','highest rank keeps special metallic tone');

// The name is contained by changing the font size uniformly, never by scaling
// the Canvas x or y axis. Confirm both short and maximum-length Japanese names.
const longestName='あいうえおかきくけこさしすせそたちつてと';
const renderFor=(name,crowned=true,rank='オリハルコン級')=>{
 const paints=[],scales=[],translations=[];
 const sample={...ctx,
  measureText(text){
   const size=Number(this.font?.match(/(\d+(?:\.\d+)?)px/)?.[1])||72;
   return {width:[...text].length*size};
  },
  translate(x,y){translations.push([x,y]);},
  scale(x,y){scales.push([x,y]);},
  fillText(text,x,y,maxWidth){
   paints.push({text,x,y,maxWidth,font:this.font,align:this.textAlign});
  }
 };
 paintAdventurerCard({getContext:()=>sample},{...data,name,crowned,rank,rankLayer:100});
 return {paints,scales,translations};
};
const short=renderFor('勇者');
const shortName=short.paints.find(op=>op.text==='勇者');
assert.ok(shortName&&shortName.font==='800 72.00px sans-serif','short name fits by height at a large, uniform 72px');
assert.equal(shortName.maxWidth,undefined,'short name is not non-uniformly stretched');
assert.equal(short.scales.length,0,'short name has no horizontal-only stretch');
assert.equal(short.translations.length,0,'short name uses ordinary canvas coordinates');
const long=renderFor(longestName);
const longNames=long.paints.filter(op=>op.text===longestName);
assert.equal(longNames.length,1,'20-character name stays on one line');
const longName=longNames[0];
const longFontSize=Number(longName.font.match(/(\d+(?:\.\d+)?)px/)?.[1]);
assert.ok(longFontSize>=17&&longFontSize<=18,'20-character name fits the width by reducing the full font size proportionally');
assert.equal(longName.maxWidth,undefined,'long name is not squashed via maxWidth');
assert.equal(long.scales.length,0,'long name has no horizontal-only stretch');
assert.ok(longName.x>=82+16&&longName.x+20*longFontSize<=502-16,
 'long name entirely fits the top-left panel without overlapping level');
assert.ok(long.paints.some(op=>op.text==='👑'&&op.x>longName.x&&op.x<502&&op.y===longName.y),
 'crown follows the fitted long name');
assert.ok(long.paints.some(op=>op.text==='オリハルコン級'&&op.x===211&&op.y===467&&op.align==='center'),
 'longest rank stays centered in the bottom-left panel');
const longCrown=long.paints.find(op=>op.text==='👑');
assert.ok(longCrown&&Math.abs((longName.x+longCrown.x+34)/2-(82+420/2))<1,
 'player name and crown are centered together as one group');
const shortRank=renderFor('勇者',false,'鉛級');
const longRank=renderFor('勇者',false,'アダマンタイト級');
const shortRankText=shortRank.paints.find(op=>op.text==='鉛級');
const longRankText=longRank.paints.find(op=>op.text==='アダマンタイト級');
const shortRankPx=Number(shortRankText?.font.match(/(\\d+(?:\\.\\d+)?)px/)?.[1]);
const longRankPx=Number(longRankText?.font.match(/(\\d+(?:\\.\\d+)?)px/)?.[1]);
assert.equal(shortRankPx,58,'short ranks use the largest font within the rank plate');
assert.ok(longRankPx<shortRankPx&&longRankPx>20,'long ranks proportionally shrink to fit');
assert.ok(longRankPx*[...'アダマンタイト級'].length<=258-28,
 'longest rank fits entirely inside the rank plaque');
assert.equal(shortRankText?.x,211,'short rank is centered');
assert.equal(longRankText?.x,211,'long rank is centered');
assert.equal(longRankText?.maxWidth,undefined,'rank fit must not squeeze glyphs on a single axis');
assert.equal(longRank.scales.length,0,'rank fit must not distort the character aspect ratio');
const largeLevel=renderFor('勇者',false);
assert.ok(largeLevel.paints.some(op=>op.text==='21'&&op.x===601&&op.align==='center'),
 'level has no prefix and is centered without a crown');

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
