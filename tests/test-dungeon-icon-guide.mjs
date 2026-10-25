import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ATTRIBUTES,ROLES} from '../assets/js/dungeon-magic-knowledge.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';

const page=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const fragment=page.split('<dialog id="iconGuideDialog"')[1]?.split('</dialog>')[0];
assert.ok(fragment,'one shared icon guide exists');
for(const title of ['属性','魔法の役割','強化','弱体','携行品']){
 assert.match(fragment,new RegExp('<h3[^>]*>'+title+'</h3>'),'category is a table group: '+title);
}
assert.equal((fragment.match(/class="icon-guide-table"/g)||[]).length,5,'each category has one table');
for(const {icon,label} of Object.values(ATTRIBUTES))assert.ok(fragment.includes('<td>'+icon+'</td><td>'+label+'</td>'),'icon and label match the grimoire: '+label);
for(const label of Object.values(ROLES))assert.ok(fragment.includes('<td>'+label.slice(0,2).replace('✚回','✚')+'</td>')||fragment.includes('<td>'+label.slice(0,1)+'</td>')||fragment.includes('<td>'+label.match(/^(?:⚔️|🛡️|✚|🕸️)/)?.[0]+'</td>'),'role icon matches gameplay');
for(const icon of ['🔥↓','⚡↓','💧↓','🌪️↓','🪨↓','⚖️↓','🌀↓','🛡️🔥↑','🌙','🔴','📜'])assert.ok(fragment.includes(icon),'status and supply icons are listed');
const prepare=page.split('<section id="prepare"')[1].split('</section>')[0];
const battle=page.split('<section id="battle"')[1].split('</section>')[0];
assert.equal((page.match(/data-action="icon-guide"/g)||[]).length,2,'exactly two launch buttons');
assert.match(prepare,/data-action="icon-guide"/);
assert.match(battle,/data-action="icon-guide"/);
assert.match(fragment,/id="closeIconGuide"/);

const env=fakeDungeonBrowser(),$=id=>env.document.getElementById(id);
const button=dataset=>({disabled:false,dataset,closest(){return this;}});
try{
 await import('../assets/js/dungeon-app.mjs?integration=icon-guide');
 const until=Date.now()+6000;
 while(!$('startupMask').hidden&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal($('startupMask').hidden,true,'app initialized');
 for(const source of ['prepare','battle']){
  await env.document.click(button({action:'icon-guide'}));
  assert.equal($('iconGuideDialog').open,true,source+' can open shared guide');
  await $('closeIconGuide').fire('click');
  assert.equal($('iconGuideDialog').open,false,'close button dismisses the guide');
 }
 assert.equal($('prepare').hidden,false,'opening the guide does not navigate away');
}finally{env.restore();}
console.log('PASS icon guide tables, preparation and battle triggers, open/close without navigation');
