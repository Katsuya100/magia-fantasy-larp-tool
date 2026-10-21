import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {supportPromptForReturn} from '../assets/js/dungeon-support.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const supportLink='https://ofuse.me/2429ddee';
const profileMarkup=html.slice(html.indexOf('<section id="home"'),html.indexOf('<section id="library"'));
assert.ok(profileMarkup.includes('class="profile-support" aria-label='),'support actions are in the profile screen');
const attributionStyles=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const attributionStart=profileMarkup.indexOf('<aside id="dungeonAttribution" class="dungeon-attribution"');
assert.ok(attributionStart>profileMarkup.indexOf('id="deleteSaveData"'),'attribution stays below profile data actions');
assert.match(profileMarkup,/<\/section>\s*<!-- Profile-only appendix[^]*?<aside id="dungeonAttribution" class="dungeon-attribution"/,'attribution is outside the profile panel');
assert.match(profileMarkup,/<aside id="dungeonAttribution"[^]*?<details>\s*<summary>✧ 外典の扉<\/summary>/,'attribution is initially collapsed in its own details');
assert.equal((html.match(/id="dungeonAttribution"/g)||[]).length,1,'exactly one dungeon attribution appendix');
assert.ok(profileMarkup.includes('href="THIRD_PARTY_NOTICES.md"')&&profileMarkup.includes('href="assets/licenses/sources.json"'),'licenses and origin registry remain discoverable');
assert.match(attributionStyles,/\.scene-stack > \.dungeon-attribution\{grid-area:2\/1;/,'attribution is placed in the second scene-grid row');
assert.match(attributionStyles,/#home\[hidden\] \+ \.dungeon-attribution\{display:none\}/,'attribution disappears whenever profile is hidden');
assert.ok(profileMarkup.indexOf('class="profile-support"')<profileMarkup.indexOf('id="deleteSaveData"'),'support and share precede data deletion');
assert.ok(profileMarkup.includes('href="https://ofuse.me/2429ddee" target="_blank" rel="noopener noreferrer"'),'public OFUSE link stays in the profile');
assert.equal((html.match(/href="https:\/\/ofuse\.me\/2429ddee"/g)||[]).length,2,'OFUSE only appears in profile and milestone choice');
assert.ok(!html.includes('id="supportDonateLink"')&&!html.includes('id="supportOptionalNote"'),'milestone dialog has no donation CTA or note');
assert.ok(html.includes('id="supportPromptClose"'),'adventurer card can be dismissed');
const milestoneHtml=html.slice(html.indexOf('<dialog id="milestoneChoiceDialog"'),html.indexOf('<dialog id="supportPromptDialog"'));
assert.ok(milestoneHtml.includes('id="milestoneShare"')&&milestoneHtml.includes('id="milestoneDonate"'),'milestone has share and OFUSE options');
assert.ok(milestoneHtml.includes('冒険を楽しんでいただき、ありがとうございます。シェアや応援をいただけると励みになります。'),'requested gratitude appears in milestone dialog');
assert.ok(milestoneHtml.includes('シェアも応援も任意です'),'milestone offers choice without payment pressure');
assert.ok(!milestoneHtml.includes('id="adventurerShareCanvas"'),'milestone dialog cannot accidentally display the full adventurer card');
assert.ok(milestoneHtml.indexOf('id="milestoneShare"')<milestoneHtml.indexOf('id="milestoneDonate"'),'share is before support');
assert.equal((milestoneHtml.match(/class="profile-action"/g)||[]).length,2,'two milestone buttons share profile design');
assert.match(milestoneHtml,/id="milestoneShare"[^>]*>.*?<svg class="share-mark"/s,'milestone share uses the existing share SVG icon');

assert.equal(supportPromptForReturn(0,9,0),null,'ordinary progress cannot trigger a prompt');
assert.equal(supportPromptForReturn(10,10,0),null,'repeating a milestone does not trigger a prompt');
assert.equal(supportPromptForReturn(20,19,0),null,'lower returns cannot trigger a prompt');
assert.deepEqual(supportPromptForReturn(9,10,0),{title:'10層の踏破記録を更新！',message:'新しい探索の節目に到達しました。'});
assert.deepEqual(supportPromptForReturn(19,21,0),{title:'20層の踏破記録を更新！',message:'新しい探索の節目に到達しました。'});
assert.deepEqual(supportPromptForReturn(9,10,10),{title:'新しい冒険者章を獲得！',message:'11層から探索できるようになりました。'},'simultaneous milestone and badge produce only one prompt');

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const attack={role:'attack',attribute:'flame',power:5000};
const wait=async check=>{
 const deadline=Date.now()+9000;
 while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(check(),'test game loaded');
};
async function fixture(depth,fight,loot=[]){
 const factory=fakeIndexedDB(),db=await openStore(factory),p=await getProfile(db);
 p.name='支援UIテスト';p.level=30;p.returns=1;p.deepestReturnedLayer=depth;
 p.slots=['a','b','c',null,null];
 p.run={floor:fight,slotIds:[...p.slots],hero:G.makeUnit(p.base,30,{},[attack,attack,attack,null,null],'player'),
  enemy:G.fromEnemy(enemies.find(e=>e.id==='boss_l010'),19),enemyName:'階層ボス',
  carry:[],loot,xp:0,usedItems:0,bonusClaimed:true,log:[],stage:'checkpoint'};
 await saveProfile(db,p);
 return {factory,db};
}
// A regular five-fight checkpoint returns to the profile without a donation prompt.
const normal=await fixture(8,45),env1=fakeDungeonBrowser({factory:normal.factory}),$1=id=>env1.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=support-normal');
 await wait(()=>$1('checkpoint').hidden===false);
 await $1('returnHome').fire('click');
 assert.equal($1('home').hidden,false);
 assert.equal($1('milestoneChoiceDialog').open,false,'ordinary return has no milestone dialog');
 assert.equal($1('supportPromptDialog').open,false,'ordinary return has no card dialog');
 await env1.document.click({disabled:false,dataset:{view:'home'},closest(){return this;}});
 assert.equal($1('milestoneChoiceDialog').open,false,'manually opening the profile has no milestone prompt');
}finally{env1.restore();}

// A newly confirmed ten-layer boundary prompts only when already on the profile.
const milestone=await fixture(9,50),env2=fakeDungeonBrowser({factory:milestone.factory}),$2=id=>env2.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=support-milestone');
 await wait(()=>$2('checkpoint').hidden===false);
 assert.equal($2('milestoneChoiceDialog').open,false,'no prompt during ordinary checkpoint');
 await $2('returnHome').fire('click');
 assert.equal($2('home').hidden,false);
 assert.equal($2('milestoneChoiceDialog').open,true);
 assert.equal($2('milestoneChoiceTitle').textContent,'10層の踏破記録を更新！');
 assert.equal($2('supportPromptDialog').open,false,'return milestone offers options instead of opening the card');
 await $2('milestoneShare').fire('click');
 assert.equal($2('milestoneChoiceDialog').open,false,'choosing share closes milestone choices');
 assert.equal($2('supportPromptDialog').open,true,'share choice opens separate adventurer card dialog');
 assert.equal($2('supportPromptTitle').textContent,'冒険者カード');
 assert.equal(new URL($2('supportXLink').href).hostname,'x.com');
 await $2('supportPromptClose').fire('click');
 assert.equal($2('supportPromptDialog').open,false,'card can be dismissed');
 await env2.document.click({disabled:false,dataset:{view:'collection'},closest(){return this;}});
 await env2.document.click({disabled:false,dataset:{view:'home'},closest(){return this;}});
 assert.equal($2('milestoneChoiceDialog').open,false,'returning to profile tab does not repeat the milestone prompt');
}finally{env2.restore();}

// A newly obtained rank presents the optional dialog AFTER the reward showcase,
// including a page reload while the showcase is pending.
const badge=await fixture(10,50,[{type:'rank',layer:10}]);
const env3=fakeDungeonBrowser({factory:badge.factory}),$3=id=>env3.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=support-badge-before-reload');
 await wait(()=>$3('checkpoint').hidden===false);
 await $3('returnHome').fire('click');
 assert.equal($3('returnShowcase').hidden,false,'rank reward screen is shown first');
 assert.equal($3('supportPromptDialog').open,false,'the prompt cannot interrupt rewards');
 assert.ok((await getProfile(badge.db)).pendingReturn.supportPrompt,'pending prompt survives the save');
}finally{env3.restore();}
const env4=fakeDungeonBrowser({factory:badge.factory}),$4=id=>env4.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=support-badge-after-reload');
 await wait(()=>$4('startupMask').hidden===true&&$4('returnShowcase').hidden===false&&$4('returnNext').textContent==='完了');
 assert.equal($4('milestoneChoiceDialog').open,false,'reload does not show milestone prematurely');
 await $4('returnNext').fire('click');
 assert.equal($4('home').hidden,false);
 assert.equal($4('milestoneChoiceDialog').open,true,'new rank offers both actions after rewards');
 assert.equal($4('supportPromptDialog').open,false,'new badge does not open the card automatically');
 assert.equal($4('milestoneChoiceTitle').textContent,'新しい冒険者章を獲得！');
 assert.equal($4('milestoneChoiceMessage').textContent,'11層から探索できるようになりました。');
 assert.equal((await getProfile(badge.db)).pendingReturn,null,'reward state clears before optional prompt');
 await $4('milestoneClose').fire('click');
 assert.equal($4('milestoneChoiceDialog').open,false);
}finally{env4.restore();}

console.log('PASS optional boss/rank action choice, explicit card opening, reload and no-pressure dismissal');
