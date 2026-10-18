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

const pentagram = radius => {
  const vertices = Array.from({length: 5}, (_, index) => point(-90 + index * 72, radius));
  return '<path d="M' + [0, 2, 4, 1, 3, 0].map(i => vertices[i]).join(' L') + '"/>';
};

const openLetter = {
  I: '<path d="M256 130 L256 382"/>',
  T: '<path d="M165 148 L347 148 M256 148 L256 374"/>',
  V: '<path d="M145 130 L256 370 L367 130"/>',
  X: '<path d="M147 148 L365 367 M365 148 L147 367"/>',
  Y: '<path d="M160 137 L256 248 L348 137 M256 248 L256 379"/>',
  Z: '<path d="M154 151 L361 151 L151 364 L360 364"/>',
};
const openRing = (radius, gapDegrees) => {
  const start = -90 + gapDegrees / 2, end = 270 - gapDegrees / 2;
  return '<path d="M' + point(start, radius) + ' A' + radius + ' ' + radius +
    ' 0 1 1 ' + point(end, radius) + '"/>';
};
const radialGap = Array.from({length: 9}, (_, index) => {
  const angle = index * 40 - 90;
  return '<path d="M' + point(angle, 45) + ' L' + point(angle, 165) + '"/>';
}).join('');

const fixtures = [
  {name: 'standard sharp 6-point star', role: 'attack', shape: star(6)},
  {name: 'standard broad 6-corner hexagon', role: 'defense', shape: polygon(6, 155)},
  {name: 'standard round contour', role: 'support', shape: '<circle cx="256" cy="256" r="150"/>'},
  {name: 'standard disconnected straight rays', role: 'debuff', shape: rays(8)},
  ...Object.entries(openLetter).map(([letter, shape]) => ({
    name: 'debuff: unclosed straight-letter ' + letter, role: 'debuff', shape,
  })),
  {name: 'debuff: nine separated radial strokes', role: 'debuff', shape: radialGap},
  {name: 'debuff: nine rays with a partial scan-rim circle', role: 'debuff',
    shape: radialGap + openRing(191, 25)},
  {name: 'debuff: nine rays with a narrow-gap scan-rim arc', role: 'debuff',
    shape: radialGap + openRing(191, 14)},
  {name: 'support: smooth interrupted circle without spokes', role: 'support',
    shape: openRing(150, 10)},
  {name: 'debuff: thin unclosed X', role: 'debuff', shape: openLetter.X, stroke: 3},
  {name: 'support: an open X inside a complete circle stays support',
    role: 'support', shape: '<circle cx="256" cy="256" r="150"/>' + openLetter.X},
  {name: 'support: an open T inside a complete circle stays support',
    role: 'support', shape: '<circle cx="256" cy="256" r="150"/>' + openLetter.T},
  {name: 'defense: a closed hexagon with open strokes stays defense',
    role: 'defense', shape: polygon(6, 155) + '<path d="M256 171 L256 340 M178 256 L332 256"/>'},
  {name: 'attack: sharp star with an added open stroke stays attack',
    role: 'attack', shape: star(6) + '<path d="M256 205 L256 305"/>'},
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
  {name: 'attack: triangular spear point', role: 'attack', shape: polygon(3, 160)},
  {name: 'attack: arrow silhouette', role: 'attack',
    shape: '<polygon points="256,92 361,245 306,245 306,388 206,388 206,245 151,245"/>'},
  {name: 'attack: lightning silhouette', role: 'attack',
    shape: '<polygon points="294,93 204,260 270,251 203,414 342,210 270,224"/>'},
  {name: 'attack: blunt five-point star', role: 'attack', shape: star(5, 162, 103)},
  {name: 'defense: five broad corners', role: 'defense', shape: polygon(5, 155)},
  {name: 'defense: thin stroke hexagon', role: 'defense', shape: polygon(6, 155), stroke: 3},
  {name: 'support: almost round dodecagon', role: 'support', shape: polygon(12, 145)},
  {name: 'attack: thin stroke star', role: 'attack', shape: star(6), stroke: 3},
  {name: 'attack: crossing pentagram', role: 'attack', shape: pentagram(160), expectPointedFaces: true},
  {name: 'attack: doubled crossing pentagram', role: 'attack', shape: pentagram(160) + pentagram(153), expectPointedFaces: true},
  {name: 'attack: overlapping triangles', role: 'attack',
    shape: polygon(3, 157, -90) + polygon(3, 157, 90), expectPointedFaces: true},
  {name: 'support: circle with cross', role: 'support',
    shape: '<circle cx="256" cy="256" r="150"/><path d="M256 125 L256 387 M125 256 L387 256"/>'},
  {name: 'support: circle with smaller crossing lines', role: 'support',
    shape: '<circle cx="256" cy="256" r="150"/><path d="M256 172 L256 340 M172 256 L340 256"/>'},

  {name: 'support: hand-drawn rounded cloud', role: 'support',
    shape: '<path d="M256 124 C290 104 324 143 350 164 C401 185 389 260 361 284 C364 347 299 390 256 362 C208 397 151 368 153 309 C120 288 119 235 148 215 C143 167 206 133 256 124 Z"/>'},
  {name: 'support: uneven smooth bubble', role: 'support',
    shape: '<path d="M270 120 C336 110 386 162 385 213 C403 272 374 324 320 336 C298 387 208 390 180 337 C130 338 114 280 142 253 C125 213 148 152 199 146 Q239 108 270 120 Z"/>'},
  {name: 'support: circle arcs crossed by long lines', role: 'support',
    shape: '<circle cx="256" cy="256" r="155"/><circle cx="256" cy="256" r="83"/><path d="M112 139 L395 382 M392 141 L126 379 M171 256 L341 256"/>'},
  {name: 'support: three round seals and a small star', role: 'support',
    shape: '<circle cx="256" cy="256" r="163"/><circle cx="290" cy="196" r="62"/><circle cx="198" cy="318" r="58"/><circle cx="333" cy="322" r="34"/><g transform="translate(290 196) scale(.26) translate(-256 -256)">' + star(5,150,70) + '</g>'},
  {name: 'support: circle ornament with small star and dotted loops', role: 'support',
    shape: '<circle cx="256" cy="256" r="162"/><circle cx="240" cy="206" r="67"/><circle cx="190" cy="318" r="46"/><circle cx="320" cy="317" r="43"/><g transform="translate(240 206) scale(.19) translate(-256 -256)">' + pentagram(156) + '</g>'},
];

let passed = 0;
const failures = [];
for (const {name, role, shape, stroke = 7, expectPointedFaces = false} of fixtures) {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="white"/><g fill="none" stroke="#111" stroke-width="' + stroke + '" stroke-linecap="round" stroke-linejoin="round">' + shape + '</g></svg>');
  const image = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { scores, features } = analyzeSigilMetricsJs(image.data, size, size, paths);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ name, expected: role, predicted: ranked[0][0], scores,
    features: {enclosedFaceCount: features.faceCount, pointedFaces: features.pointedFaces, roundedAreaShare: features.roundedAreaShare, mean: features.mean, radialVariation: features.radialVariation,
      broadAngleRatio: features.broadAngleRatio, sharpTipCount: features.sharpTipCount,
      missingRayRatio: features.missingRayRatio, openPathStraightness: features.openPathStraightness, broadBendRuns: features.broadBendRuns} }));
  if (ranked[0][0] !== role || ranked[0][1] < .35 || ranked[0][1] - ranked[1][1] < .02 ||
    (expectPointedFaces && features.pointedFaces < 2)) {
    failures.push(name + ': expected ' + role + ', got ' + ranked[0][0] + ', margin=' + (ranked[0][1] - ranked[1][1]).toFixed(3));
  } else passed++;
}
console.log('SIGIL RESULT ' + passed + '/' + fixtures.length + ' passing');
assert.deepEqual(failures, [], failures.join('\n'));
