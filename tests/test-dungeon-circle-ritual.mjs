import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CIRCLE_RITUAL_DURATION_MS,circleRitualLabels,playCircleReveal,playCircleUpgrade} from '../assets/js/dungeon-circle-ritual.mjs';

const source=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.equal(CIRCLE_RITUAL_DURATION_MS,800,'both sequences must last 0.8 seconds');
const attributes={
 flame:'🔥 炎の相',bolt:'⚡ 雷の相',aqua:'💧 水の相',storm:'🌪️ 風の相',
 gravity:'🪨 重力の相',law:'⚖️ 秩序の相',chaos:'🌀 混沌の相'
};
const roles={attack:'⚔️ 攻撃の紋',defense:'🛡️ 防御の紋',support:'✚ 回復の紋',debuff:'🕸️ 弱体の紋'};
for(const [attribute,text] of Object.entries(attributes))
 assert.equal(circleRitualLabels({attribute,role:'attack'})[0],text);
for(const [role,text] of Object.entries(roles))
 assert.equal(circleRitualLabels({attribute:'flame',role})[1],text);
assert.match(source,/show\('library'\);\s*returnToCameraScroll\(\);\s*await playCircleReveal\(analyzed\)/,'photo realization is after saved circle and visible library');
assert.match(source,/show\('battle'\);await playCircleReveal\(circle\);await takeTurn\(index\)/,'dungeon analysis has its own reveal before casting');
assert.match(source,/saveProfile\(db,nextProfile\)[\s\S]*?playCircleUpgrade\(circle,\$\('magicUpgradeEffect'\)\)/,'upgrade effect starts only after profile saving');
assert.match(html,/<div class="magic-details-art"><img id="magicDetailsImage"[^>]*><div id="magicUpgradeEffect"/,'new glow overlays the existing real photo');
assert.match(css,/\.circle-ritual__veil[\s\S]*?circle-ritual-veil var\(--ritual-duration\)/,'reveal includes black backdrop');
for(const animation of ['circle-ritual-ring-in','circle-upgrade-aura','circle-ritual-ink','circle-ritual-veil']){
 assert.ok(css.includes('@keyframes '+animation),'missing '+animation);
}
assert.match(css,/--ritual-duration:\.8s/,'CSS duration stays synchronized with JS');
assert.doesNotMatch(css,/circle-upgrade-glow|data-enhancing="true"\] \.magic-details-content:after/,'old long upgrade animation is removed without changing combat timing');
assert.match(css,/\.circle-ritual--upgrade\{/,'upgrades share ritual glow without a black backdrop');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*\.circle-ritual\{display:none!important\}/,'reduced motion bypass');
await playCircleReveal({analysis:{attribute:'law',role:'support'},image:new Blob(['photo'])});
await playCircleUpgrade({analysis:{attribute:'law',role:'support'}},null);
console.log('PASS circle realization, seven aspects, four sigils, 800ms enhancement and scope');
