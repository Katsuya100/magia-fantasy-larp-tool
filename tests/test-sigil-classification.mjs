import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

// Exercise the exact image geometry function imported by the browser's
// structure worker. OCR/embedding use ONNX/WASM; sigil classification itself
// is JS, so turning on an ONNX backend does not change these scores.
const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../assets/js/image-analysis-core.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'image-analysis-core.js' });
const { analyzeSigilMetricsJs } = context.ImageAnalysisCore;
const size = 512;
const center = size / 2;
const boundary = center * .8;
const paths = { inner: { x: center, y: center, r: boundary, radii: Array(360).fill(boundary) } };

const point = (angle, radius) => {
  const theta = angle * Math.PI / 180;
  return (center + Math.cos(theta) * radius).toFixed(2) + ',' +
    (center + Math.sin(theta) * radius).toFixed(2);
};
const polygon = (count, radius, angle = -90) =>
  '<polygon points="' + Array.from({ length: count }, (_, index) => point(angle + index * 360 / count, radius)).join(' ') + '"/>';
const star = (points, outer = 160, inner = 58, angle = -90) =>
  '<polygon points="' + Array.from({ length: points * 2 }, (_, index) =>
    point(angle + index * 180 / points, index % 2 ? inner : outer)).join(' ') + '"/>';
const rays = (count, angleOffset = 8) =>
  Array.from({ length: count }, (_, index) => {
    const angle = index * 360 / count + angleOffset;
    const end = [150, 115, 165, 125, 155, 105, 160, 130][index % 8];
    return '<path d="M' + point(angle, 18) + ' L' + point(angle, end) + '"/>';
  }).join('');

// Standard shapes plus edge cases, generated deterministically as real RGBA
// from SVG. These are explicitly visual expectations, not trained labels.
const fixtures = [
  {name: 'standard sharp 6-point star', role: 'attack', shape: star(6)},
  {name: 'standard broad 6-corner hexagon', role: 'defense', shape: polygon(6, 155)},
  {name: 'standard round contour', role: 'support', shape: '<circle cx="256" cy="256" r="150"/>'},
  {name: 'standard disconnected straight rays', role: 'debuff', shape: rays(8)},
  {name: 'attack: 5-point star', role: 'attack', shape: star(5, 158, 68)},
  {name: 'attack: rotated 8-point star', role: 'attack', shape: star(8, 165, 74, -78)},
  {name: 'defense: rotated hexagon', role: 'defense', shape: polygon(6, 155, -60)},
  {name: 'defense: small hexagon', role: 'defense', shape: polygon(6, 112)},
  {name: 'defense: irregular hand-drawn hexagon', role: 'defense',
    shape: '<polygon points="250,106 382,178 373,320 252,394 129,317 139,181"/>'},
  {name: 'defense: classic shield with tapered bottom', role: 'defense',
    shape: '<path d="M174 128 Q256 98 338 128 L329 237 Q315 333 256 384 Q197 333 183 237 Z"/>'},
  {name: 'defense: rounded shield', role: 'defense',
    shape: '<path d="M182 142 Q256 115 330 142 Q325 260 308 308 Q280 357 256 375 Q232 357 204 308 Q187 260 182 142 Z"/>'},
  {name: 'defense: shield with internal center line', role: 'defense',
    shape: '<path d="M174 128 Q256 98 338 128 L329 237 Q315 333 256 384 Q197 333 183 237 Z"/><path d="M256 140 L256 348"/>'},
  {name: 'support: smaller circle', role: 'support', shape: '<circle cx="256" cy="256" r="115"/>'},
  {name: 'support: oval contour', role: 'support', shape: '<ellipse cx="256" cy="256" rx="135" ry="153"/>'},
  {name: 'debuff: fewer disconnected rays', role: 'debuff', shape: rays(5, 10)},
];

let passed = 0;
const failures = [];
for (const {name, role, shape} of fixtures) {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="white"/><g fill="none" stroke="#111" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' + shape + '</g></svg>');
  const image = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { scores, features } = analyzeSigilMetricsJs(image.data, size, size, paths);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ name, expected: role, predicted: ranked[0][0], scores,
    features: {mean: features.mean, radialVariation: features.radialVariation,
      broadAngleRatio: features.broadAngleRatio, sharpTipCount: features.sharpTipCount,
      missingRayRatio: features.missingRayRatio, broadBendRuns: features.broadBendRuns} }));
  if (ranked[0][0] !== role || ranked[0][1] < .35 || ranked[0][1] - ranked[1][1] < .02) {
    failures.push(name + ': expected ' + role + ', got ' + ranked[0][0] + ', margin=' + (ranked[0][1] - ranked[1][1]).toFixed(3));
  } else passed++;
}
console.log('SIGIL RESULT ' + passed + '/' + fixtures.length + ' passing');
assert.deepEqual(failures, [], failures.join('\n'));
