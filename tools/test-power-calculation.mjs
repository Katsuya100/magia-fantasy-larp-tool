import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../power-calculation.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'power-calculation.js' });
const { calculatePower } = context.PowerCalculationCore;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT power_calculation=FAIL: ${message}`);
}

const maximum = calculatePower({
  circleAccuracy: 1,
  lineStraightness: 1,
  attributeCertainty: 1,
  sigilCertainty: 1,
  wordCount: 10,
});
assert(maximum.power === 1000, 'ten words with maximum quality must produce 1000');

const minimum = calculatePower({
  circleAccuracy: 0,
  lineStraightness: 0,
  attributeCertainty: 0,
  sigilCertainty: 0,
  wordCount: 0,
});
assert(minimum.power === 0, 'minimum inputs must produce 0');

const example = calculatePower({
  circleAccuracy: 0.8,
  lineStraightness: 0.6,
  attributeCertainty: 0.7,
  sigilCertainty: 0.9,
  wordCount: 5,
});
assert(example.power === 375, 'example score must multiply quality by word count');
assert(example.normalized.wordCount === 5, 'word count must remain available as a raw parameter');
assert(Math.abs(example.qualityAverage - 0.75) < 0.000001, 'quality average must use the four quality parameters');

const bounded = calculatePower({
  circleAccuracy: 2,
  lineStraightness: -1,
  attributeCertainty: 0.5,
  sigilCertainty: 0.5,
  wordCount: 30,
});
assert(bounded.power === 1500, 'quality inputs must clamp without capping word count');
assert(bounded.power > maximum.power, 'power must grow beyond the ten-word example');

const uniqueWords = calculatePower({
  circleAccuracy: 1,
  lineStraightness: 1,
  attributeCertainty: 1,
  sigilCertainty: 1,
  words: ['Fire', 'fire', 'water', 'WATER', 'storm!'],
});
assert(uniqueWords.normalized.wordCount === 3, 'duplicate words must be counted once');
assert(uniqueWords.power === 300, 'power must use the unique word count');

let rejected = false;
try {
  calculatePower({ circleAccuracy: 1, lineStraightness: 1, attributeCertainty: 1, sigilCertainty: 1, wordCount: -1 });
} catch {
  rejected = true;
}
assert(rejected, 'negative word counts must be rejected');

console.log(JSON.stringify({ maximum, minimum, example, bounded }, null, 2));
console.log('ASSERT power_calculation=PASS');
