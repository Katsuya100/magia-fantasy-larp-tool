import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../attribute-scoring.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'attribute-scoring.js' });
const { normalizeSimilarities, allocateWholePercentages } = context.AttributeScoringCore;

const thunder = normalizeSimilarities([
  ['bolt', 0.62], ['storm', 0.59], ['flame', 0.37], ['aqua', 0.34],
  ['gravity', 0.31], ['law', 0.29], ['chaos', 0.28],
]);
assert.ok(Math.abs(thunder.reduce((sum, [, , percentage]) => sum + percentage, 0) - 100) < 1e-9, 'display percentages must sum to 100');
assert.ok(thunder[0][1] > thunder[1][1], 'closer semantic matches must receive larger shares');
assert.ok(thunder[0][1] - thunder[1][1] > (0.62 - 0.59) / 7, 'similarity gaps must be visible beyond simple normalization');
assert.equal(thunder[0][0], 'bolt', 'the highest similarity must remain the highest share');

const lawSupport = normalizeSimilarities([
  ['law', 0.2246662682], ['flame', 0.2035238861], ['storm', 0.1698652223],
  ['chaos', 0.1465146426], ['bolt', 0.1433808125], ['gravity', 0.1405871835], ['aqua', 0.1244782650],
]);
assert.ok(lawSupport.every((entry, index) => index === 0 || lawSupport[index - 1][2] > entry[2]), 'the attached-image similarities must remain visibly ordered at one decimal place');

const equal = normalizeSimilarities([['a', 0.5], ['b', 0.5], ['c', 0.5]]);
assert.deepEqual(Array.from(equal, ([key, , percentage]) => [key, percentage]), [['a', 33.4], ['b', 33.3], ['c', 33.3]], 'equal similarities should divide the 1000 tenths evenly');
const reversed = normalizeSimilarities([['c', 0.5], ['b', 0.5], ['a', 0.5]]);
assert.deepEqual(Array.from(reversed, ([key, , percentage]) => [key, percentage]).sort(), [['a', 33.4], ['b', 33.3], ['c', 33.3]], 'ties must not depend on candidate rank or input order');
assert.throws(() => normalizeSimilarities([['a', 1]], 0), /temperature must be positive/, 'temperature must be positive');

const roundedNinetyNine = allocateWholePercentages([['support', 1], ['attack', 1], ['debuff', 1]]);
assert.equal([...roundedNinetyNine.values()].reduce((sum, value) => sum + value, 0), 100, 'whole-number display percentages must sum to 100');
assert.deepEqual(Array.from(roundedNinetyNine, ([key, value]) => [key, value]), [['support', 33], ['attack', 34], ['debuff', 33]], 'equal fractional remainders use stable key order');
const tied = allocateWholePercentages([['support', 1], ['attack', 1], ['debuff', 1]]);
assert.deepEqual(Array.from(tied, ([key, value]) => [key, value]), [['support', 33], ['attack', 34], ['debuff', 33]], 'allocation is stable by key while preserving input order');
assert.equal(Array.from(tied).sort((a, b) => b[1] - a[1])[0][0], 'attack', 'allocated display ranks are deterministic');
const ranked = allocateWholePercentages([['attack', .52], ['support', .27], ['defense', .14], ['debuff', .07]]);
assert.ok(ranked.get('attack') > ranked.get('support') && ranked.get('support') > ranked.get('defense') && ranked.get('defense') > ranked.get('debuff'), 'whole-number display allocation must preserve distinct score ranks');
console.log('PASS_ATTRIBUTE_SCORING');
