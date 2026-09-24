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

const fixtures = [
  ['star points are attack', 'attack', `<polygon points="${starPoints}"/>`],
  ['six broad corners are defense', 'defense', `<polygon points="${hexagonPoints}"/>`],
  ['round contour is support', 'support', '<circle cx="256" cy="256" r="150"/>'],
  ['separated straight lines are debuff', 'debuff', rayPaths],
];

for (const [name, expected, shape] of fixtures) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="white"/><g fill="none" stroke="#111" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`);
  const image = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metrics = analyzeSigilMetricsJs(image.data, size, size, paths);
  const [top, second] = Object.entries(metrics.scores).sort((left, right) => right[1] - left[1]);
  const percentage = Math.round(top[1] * 1000) / 10;
  console.log(`${name}: ${top[0]} ${percentage}% (${expected} expected); ${JSON.stringify({ scores: metrics.scores, features: metrics.features })}`);
  assert.equal(top[0], expected, `${name} should follow the shared shape vocabulary`);
  assert.ok(top[1] >= .4, `${name} should have at least 40% top share`);
  assert.ok(top[1] > second[1], `${name} should have a unique top category`);
}
