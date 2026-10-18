import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../assets/js/image-analysis-core.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'image-analysis-core.js' });
const { analyzeSigilMetricsJs } = context.ImageAnalysisCore;
const size = 512;
const center = size / 2;
const boundary = center * .8;
const paths = {
  inner: {
    x: center,
    y: center,
    r: boundary,
    radii: Array(360).fill(boundary),
  },
};

const point = (angle, radius) => {
  const theta = angle * Math.PI / 180;
  return `${(center + Math.cos(theta) * radius).toFixed(2)},${(center + Math.sin(theta) * radius).toFixed(2)}`;
};
const starPoints = Array.from({ length: 12 }, (_, index) => point(index * 30 - 90, index % 2 ? 58 : 160)).join(' ');
const hexagonPoints = Array.from({ length: 6 }, (_, index) => point(index * 60 - 90, 155)).join(' ');
const rayPaths = Array.from({ length: 8 }, (_, index) => {
  const angle = index * 45 + 8;
  const endRadius = [150, 115, 165, 125, 155, 105, 160, 130][index];
  return `<path d="M${point(angle, 18)} L${point(angle, endRadius)}"/>`;
}).join('');

// All cases create real pixels from vector drawings, not mocked feature values.
// The inner-circle boundary is fixed to isolate the sigil classifier from OCR and
// circle detection. This is the exact shared classifier used by the browser Worker.
const polygon = (sides, radius, rotation = -90, offsetX = 0, offsetY = 0) =>
  '<polygon points="' + Array.from({length:sides},(_,i)=>{
    const theta=(rotation+i*360/sides)*Math.PI/180;
    return `${(center+offsetX+Math.cos(theta)*radius).toFixed(2)},${(center+offsetY+Math.sin(theta)*radius).toFixed(2)}`;
  }).join(' ') + '"/>';
const star = (tips, outer=160, inner=58, rotation=-90) =>
  '<polygon points="' + Array.from({length:tips*2},(_,i)=>point(rotation+i*180/tips,i%2?inner:outer)).join(' ') + '"/>';
const shield = '<path d="M161 132 L351 132 L344 264 Q334 338 256 394 Q178 338 168 264 Z"/>';
const roundedShield = '<path d="M166 133 Q211 114 256 125 Q301 114 346 133 Q353 243 327 300 Q293 365 256 383 Q219 365 185 300 Q159 243 166 133 Z"/>';
const flatShield = '<path d="M160 132 L352 132 L347 271 L256 383 L165 271 Z"/>';
const notchedShield = '<path d="M161 132 L218 132 L256 152 L294 132 L351 132 L345 270 Q329 337 256 395 Q183 337 167 270 Z"/>';
const stretchedShield = '<path d="M184 108 L328 108 L340 265 Q322 360 256 402 Q190 360 172 265 Z"/>';
const rays = (count) => Array.from({length:count},(_,i)=>{
  const angle=i*360/count+8;
  return `<path d="M${point(angle,18)} L${point(angle, [150,115,165,125,155,105,160,130][i%8])}"/>`;
}).join('');
const fixtures = [
  {name:'star (6 tips)',expected:'attack',svg:star(6)},
  {name:'star (5 tips)',expected:'attack',svg:star(5,164,65)},
  {name:'star (7 tips)',expected:'attack',svg:star(7,165,60)},
  {name:'hexagon',expected:'defense',svg:polygon(6,155)},
  {name:'hexagon rotated',expected:'defense',svg:polygon(6,155,-60)},
  {name:'hexagon offset',expected:'defense',svg:polygon(6,151,-84,7,-4)},
  {name:'octagon',expected:'defense',svg:polygon(8,157)},
  {name:'classic shield',expected:'defense',svg:shield},
  {name:'round-bottom shield',expected:'defense',svg:roundedShield},
  {name:'flat-sided shield',expected:'defense',svg:flatShield},
  {name:'notched shield',expected:'defense',svg:notchedShield},
  {name:'tall shield',expected:'defense',svg:stretchedShield},
  {name:'circle medium',expected:'support',svg:'<circle cx="256" cy="256" r="150"/>'},
  {name:'circle large',expected:'support',svg:'<circle cx="256" cy="256" r="183"/>'},
  {name:'circle small',expected:'support',svg:'<circle cx="256" cy="256" r="115"/>'},
  {name:'ellipse',expected:'support',svg:'<ellipse cx="256" cy="256" rx="163" ry="130"/>'},
  {name:'separate rays (8)',expected:'debuff',svg:rayPaths},
  {name:'separate rays (6)',expected:'debuff',svg:rays(6)},
  // Pen thicknesses can vary substantially with camera distance.
  {name:'hexagon thin pen',expected:'defense',svg:polygon(6,155),stroke:4},
  {name:'hexagon broad pen',expected:'defense',svg:polygon(6,155),stroke:12},
  {name:'shield broad pen',expected:'defense',svg:shield,stroke:12},
  {name:'circle broad pen',expected:'support',svg:'<circle cx="256" cy="256" r="150"/>',stroke:12},
];

const failures = [];
for (const {name,expected,svg,stroke=7} of fixtures) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="white"/><g fill="none" stroke="#111" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${svg}</g></svg>`);
  const image = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metrics = analyzeSigilMetricsJs(image.data, size, size, paths);
  const [top, second] = Object.entries(metrics.scores).sort((left, right) => right[1] - left[1]);
  const percentage = Math.round(top[1] * 1000) / 10;
  console.log(`${name}: ${top[0]} ${percentage}% (${expected} expected); ${JSON.stringify({ scores: metrics.scores, features: metrics.features })}`);
  if (top[0] !== expected || top[1] < .4 || top[1] <= second[1]) failures.push(`${name}: expected ${expected} >=40%, got ${top[0]} ${percentage}%`);
}
assert.equal(failures.length, 0, '\\n' + failures.join('\\n'));
console.log(`PASS ${fixtures.length} synthetic sigil classification cases`);
