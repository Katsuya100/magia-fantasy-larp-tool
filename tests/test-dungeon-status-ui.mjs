import assert from 'node:assert/strict';
import {statusBadges} from '../assets/js/dungeon-status-ui.mjs';
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buffs=[
 {id:'buff_flame',name:'炎熱鼓舞'},
 {id:'debuff_aqua',name:'浸水'},
 {id:'buff_storm',name:'嵐の衣'},
 {id:'resist_bolt',name:'bolt耐性上昇'}
];
const states=[
 {id:'buff_flame',attribute:'flame',kind:'buff',turns:2},
 {id:'debuff_aqua',attribute:'aqua',kind:'debuff',turns:1},
 {id:'resist_bolt',attribute:'bolt',kind:'buff',turns:3},
 {id:'buff_storm',attribute:'storm',kind:'buff',turns:4}
];
const html=statusBadges(states,buffs,escapeText);
assert.equal((html.match(/class="status-badge/g)||[]).length,4,'one compact icon per active status');
assert.match(html,/status-buff" role="img" title="炎熱鼓舞・強化・残り2ターン" aria-label="炎熱鼓舞・強化・残り2ターン"/);
assert.match(html,/status-debuff" role="img" title="浸水・弱体・残り1ターン"/);
assert.match(html,/class="status-glyph" aria-hidden="true">🔥<\/span><span class="status-arrow" aria-hidden="true">↑<\/span>/,'flame buff uses fire and upward marker');
assert.match(html,/class="status-glyph" aria-hidden="true">💧<\/span><span class="status-arrow" aria-hidden="true">↓<\/span>/,'aqua debuff uses water and downward marker');
assert.match(html,/class="status-badge status-buff status-resist"/,'defensive resistance has distinct style');
assert.match(html,/class="status-glyph" aria-hidden="true">🛡️⚡<\/span>/,'resistance shows shield and elemental icon together');
assert.match(html,/嵐の衣・強化・残り4ターン/,'additional statuses retain their names');
assert.equal((html.match(/<small class="status-turns" aria-hidden="true">[1-4]<\/small>/g)||[]).length,4,'duration stays visible as small number');
assert.equal(statusBadges([],buffs,escapeText),'','empty statuses stay empty');
const unknown=statusBadges([{id:'unknown',attribute:'invalid',kind:'debuff',turns:NaN}],buffs,escapeText);
assert.match(unknown,/✦/,'unknown attributes have safe fallback icon');
assert.match(unknown,/残り0ターン/,'invalid durations do not show NaN');
const injection=statusBadges([{id:'unknown',attribute:'flame',kind:'buff',turns:1}], [{id:'unknown',name:'<img src=x>'}],escapeText);
assert.doesNotMatch(injection,/title="<img/,'status labels escape HTML in title and aria');
assert.match(injection,/&lt;img src=x&gt;/);
console.log('PASS icon-only combat status effects, buff/debuff polarity, duration and accessible descriptions');
