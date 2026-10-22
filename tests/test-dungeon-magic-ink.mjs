import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bossDropsMagicInk,inkEnhancedAnalysis,BOSS_INK_DROP_CHANCE,MAGIC_INK_ID} from '../assets/js/dungeon-ink.mjs';
import {drops,parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

assert.equal(BOSS_INK_DROP_CHANCE,.20);
assert.equal(bossDropsMagicInk(null,()=>0),false,'normal enemies cannot drop ink');
assert.equal(bossDropsMagicInk('boss_l001',()=>.19999),true);
assert.equal(bossDropsMagicInk('boss_l001',()=>.2),false);
let successes=0;
for(let i=0;i<100;i++)if(bossDropsMagicInk('boss_l100',()=>i/100))successes++;
assert.equal(successes,20,'exact 20% probability boundary');
assert.equal(inkEnhancedAnalysis({attribute:'law',role:'attack',power:250}).power,275);
assert.equal(inkEnhancedAnalysis({power:201}).power,222,'fractional bonus rounds upwards');
assert.equal(inkEnhancedAnalysis({power:150}).power,165,'ink is applied after hand-drawn adjustment');

const read=async name=>parseCsv(await readFile(new URL('../assets/data/'+name,import.meta.url),'utf8'));
const [items,collections,balance,levels,floors,playerBase]=await Promise.all(
 ['dungeon-consumables.csv','dungeon-collections.csv','dungeon-balance.csv','dungeon-levels.csv','dungeon-floors.csv','dungeon-player-base.csv'].map(read));
configure({balance,levels,floors,playerBase});
const boss={layer:1,bossEnemyId:'boss_l001'};
assert.deepEqual(drops(items,collections,1,()=>.1,boss).filter(x=>x.type==='ink'),[{type:'ink',id:MAGIC_INK_ID}]);
assert.equal(drops(items,collections,1,()=>.1,{layer:1}).some(item=>item.type==='ink'),false);
assert.equal(drops(items,collections,1,()=>.9,boss).some(item=>item.type==='ink'),false);

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const arena=html.slice(html.indexOf('id="battleArena"'),html.indexOf('id="battleInfo"'));
assert.ok(arena.indexOf('id="heroCombatant"')<arena.indexOf('id="enemyCombatant"'),'hero on left and enemy on right');
assert.match(css,/\.spell-projectile\[data-side="hero"\]\{\s*--flight-from:calc\(25%/,'hero projectile begins at left desktop');
assert.match(css,/@media\(max-width:630px\)\{\s*#battleArena \.spell-projectile\{\s*--flight-from:calc\(75%/,'enemy projectile begins at right mobile');
assert.match(css,/@keyframes enemy-snap-slide\{\s*0%\{opacity:0;transform:translateX\(48px\)/,'enemy enters from right');
assert.match(css,/@keyframes boss-cinematic-rise\{\s*0%\{opacity:0;transform:translateX\(35px\)/,'boss enters from right');
assert.match(css,/@keyframes snappy-rush-hero\{[\s\S]*?translateX\(34px\)/,'hero charges toward right');
assert.match(css,/@keyframes snappy-rush-enemy\{[\s\S]*?translateX\(-34px\)/,'enemy charges toward left');
assert.match(css,/@keyframes boss-cinematic-collapse\{[\s\S]*?translateX\(5px\)/,'defeated boss recoils to right');
assert.match(html,/id="useMagicInk"/,'ink selection available only in grimoire');
assert.match(app,/await saveProfileWithCircles\(db,nextProfile,\[analyzed\]\)/,'ink consumption and new circle atomic');
assert.match(app,/if\(circle.creationInk\)/,'magic-circle details record use of ink');
console.log('PASS ink boss drops, crafting bonus, atomic registration and orientation');
