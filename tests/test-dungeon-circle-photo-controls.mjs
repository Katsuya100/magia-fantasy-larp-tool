import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spellGrid,circleChoices,itemGrid,itemChoices} from '../assets/js/dungeon-preparation-ui.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [css,page,app]=await Promise.all([
 read('assets/css/dungeon.css'),read('dungeon.html'),read('assets/js/dungeon-app.mjs')
]);
const inset=css.match(/--circle-guide-inset:(\d+)%/);
assert.equal(Number(inset?.[1]),7,'camera guide is 86% diameter');
assert.match(css,/\.camera-viewfinder \.viewfinder-circle-guide\{[^}]*inset:var\(--circle-guide-inset\)/);
assert.match(css,/\.circle-photo-face > img\{[^}]*clip-path:circle\(calc\(50% - var\(--circle-guide-inset\)\) at 50% 50%\)/);
assert.match(css,/\.circle-photo-face::before\{[^}]*inset:var\(--circle-guide-inset\)/);
assert.match(css,/\.circle-ritual--reveal \.circle-ritual__physical\{[^}]*clip-path:circle\(calc\(50% - var\(--circle-guide-inset\)\) at 50% 50%\)/);
assert.match(css,/\.circle-ritual--reveal \.circle-ritual__ring\{inset:var\(--circle-guide-inset\)\}/);
assert.doesNotMatch(css,/\.circle-ritual--upgrade \.circle-ritual__physical\{/,
 'upgrade animation and detail art remain untouched');

const circle={id:'test-circle',image:{},analysis:{attribute:'flame',role:'attack',power:250}};
const escapeText=value=>String(value);
const slots=spellGrid([circle.id,null],[circle],()=>'/photo.jpg',escapeText);
assert.match(slots,/data-open-slot="0"[^>]*><span class="tile-index">01<\/span><span class="circle-photo-face"><img[^>]*data-circle-photo-id="test-circle"[^>]*><\/span>/);
assert.match(slots,/class="loadout-tile empty"/,'empty spell slot has no photo frame');
const choices=circleChoices([circle],[],()=>'/photo.jpg',escapeText);
assert.match(choices,/data-choose-circle="0"[^>]*>\s*<span class="circle-photo-face"><img[^>]*><\/span><\/button>/);
assert.doesNotMatch(itemGrid([],[],3,false,()=>'',escapeText),/circle-photo-face/);
assert.doesNotMatch(itemChoices([],[],()=>'',escapeText),/circle-photo-face/);
assert.match(app,/class="battle-spell-photo circle-photo-face"><img[^\n]*data-circle-photo-id=/);
assert.match(app,/class="circle-photo-face"><img alt="魔法陣"[^\n]*aria-pressed=/);
assert.match(page,/dungeon\.css\?v=20261022\.11/);
assert.match(page,/dungeon-app\.mjs\?v=20261022\.11/);
assert.match(app,/dungeon-preparation-ui\.mjs\?v=20261022\.11/);
const controls=css.slice(css.indexOf('.circle-photo-face{'),css.indexOf('/* Revelation only:'));
assert.match(controls,/\.circle-photo-face\{[^}]*border-radius:50%;overflow:hidden/,
 'round photo frames never protrude beyond the button surface');
assert.doesNotMatch(controls,/drop-shadow\(|translateY\(-2px\)|scale\(1\.035\)/,
 'floating shadows and outward hover scaling cannot spill over backgrounds');
assert.match(controls,/\.circle-photo-face::before\{[^}]*inset:var\(--circle-guide-inset\)/,
 'raised metal rim stays at the camera guide circumference');
assert.doesNotMatch(controls,/\.circle-photo-face::after/,
 'no operation plaque overlaps any circular photo');
assert.doesNotMatch(controls,/content:"(?:発動|変更|選ぶ|長押し ★)"/,
 'all former circular-photo action labels are removed');
assert.ok(app.includes('tile-cooldown')&&app.includes("'+state.cooldown+'"),
 'battle spell retains its separate cast/cooldown text below the photo');
assert.match(controls,/\.prepare-spell-frame \.loadout-tile\.equipped\{[^}]*padding:0!important;gap:0;justify-content:center/,
 'preparation spell tile has no padding around the photo');
assert.match(controls,/\.prepare-spell-frame \.loadout-tile \.circle-photo-face,\s*\.battle-spells \.battle-spell-photo\.circle-photo-face\{[^}]*width:100%;max-width:none/,
 'preparation and battle photos span the button width');
assert.match(controls,/\.battle-spells \.battle-spell-tile\[data-cast\] \.tile-cooldown\{[^}]*border-top:1px solid/,
 'battle cast text is a footer below the photo');
assert.match(controls,/\.battle-spells \.battle-spell-tile\[data-cast\]\{[^}]*padding:0!important;gap:0/,
 'battle tile photo and footer form one button');
assert.doesNotMatch(controls,/\.circle-photo-face > img\{[^}]*object-position:/,
 'photo alignment and saved image are unchanged');
console.log('PASS guided circular spell photos with no overlapping action plaques');
