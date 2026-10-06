import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const name of ['runtime-dependencies', 'spell-ocr', 'image-analysis-core', 'power-calculation', 'attribute-scoring', 'ocr-error-policy', 'magia-image-pipeline', 'magia-circle-results']) {
  await import(`../assets/js/${name}.js`);
}

// Supply DOM sinks only; all scored values come from production shared cores.
const elements = Object.fromEntries(['powerResult', 'powerDetail', 'shapeResult', 'shapeDetail', 'attributeResult', 'attributeDetail', 'modelStatus'].map(name => [name, {}]));
const powerInputs = { circleAccuracy: null, lineStraightness: null, ringCoverage: null, attributeCertainty: null, sigilCertainty: null, wordCount: null };
const diagnostics = {};
const statuses = [];
const view = MagiaCircleResults.create({ elements, powerInputs, diagnostics, setStatus: (...args) => statuses.push(args) });
view.renderPower();
assert.equal(elements.powerResult.className, 'result-empty');
assert.match(elements.powerResult.innerHTML, /共鳴率が揃うと、威力が現れます/);
assert.match(elements.powerDetail.textContent, /すべての共鳴率が揃うと現れます/);
assert.equal(diagnostics.power, undefined, 'An incomplete analysis must not publish a power result.');

Object.assign(powerInputs, { circleAccuracy: .8, lineStraightness: .6, ringCoverage: .5, attributeCertainty: .7, sigilCertainty: .9, wordCount: 5 });
const power = PowerCalculationCore.calculatePower(powerInputs);
assert.equal(power.power, 350);
view.renderPower(power);
assert.equal(diagnostics.power, power, 'Rendering must retain the precomputed shared result.');
assert.equal(elements.powerResult.className, 'altar-result altar-result--power');
assert.match(elements.powerResult.innerHTML, />350</);
assert.match(elements.powerDetail.innerHTML, /<strong>5語<\/strong>/);
assert.equal((elements.powerDetail.innerHTML.match(/class="bar-row"/g) || []).length, 5);
assert.match(elements.powerDetail.innerHTML, /環と呪文の共鳴率/);
assert.doesNotMatch(elements.powerDetail.innerHTML, /NaN|undefined/);

const rates = AttributeScoringCore.normalizeSimilarities([
  ['bolt', .62], ['storm', .59], ['flame', .37], ['aqua', .34], ['gravity', .31], ['law', .29], ['chaos', .28],
]);
const attribute = { rates, top: rates[0][0], certainty: rates[0][1], similarities: {} };
assert.equal(view.renderAttribute(attribute), attribute.certainty);
assert.match(elements.attributeResult.innerHTML, /⚡/);
assert.match(elements.attributeResult.innerHTML, /最も共鳴した相/);
assert.equal((elements.attributeDetail.innerHTML.match(/attribute-detail-row/g) || []).length, 7);
const attributePercentages = [...elements.attributeDetail.innerHTML.matchAll(/<strong>(\d+\.\d)%<\/strong>/g)].map(match => Number(match[1]));
assert.equal(attributePercentages.length, 7);
assert.ok(Math.abs(attributePercentages.reduce((total, percentage) => total + percentage, 0) - 100) < 1e-9);
assert.deepEqual(attributePercentages, rates.map(([, , percentage]) => percentage));
assert.equal(statuses.at(-1)[2], 'good');

const sigil = MagiaImagePipeline.scoreSigil({ attack: .52, support: .27, defense: .14, debuff: .07 });
assert.equal(view.renderShape(sigil), .52);
assert.match(elements.shapeResult.innerHTML, /⚔️/);
assert.match(elements.shapeResult.innerHTML, /最も共鳴した紋/);
assert.equal((elements.shapeDetail.innerHTML.match(/class="bar-row"/g) || []).length, 4);
const sigilPercentages = [...elements.shapeDetail.innerHTML.matchAll(/<strong>(\d+)%<\/strong>/g)].map(match => Number(match[1]));
assert.deepEqual(sigilPercentages, [52, 27, 14, 7]);
assert.equal(sigilPercentages.reduce((sum, percentage) => sum + percentage, 0), 100);
assert.equal(view.renderShape(null), .25, 'Missing shapes must keep the shared equal-score fallback.');

const externalError = new Error('<img src=x onerror=alert(1)>');
assert.equal(view.renderAttribute({ rates: [], error: externalError }), 0);
assert.match(elements.attributeDetail.innerHTML, /呪文から相を判定できませんでした/);
assert.equal((elements.attributeDetail.innerHTML.match(/<strong>0%<\/strong>/g) || []).length, 7);
assert.doesNotMatch(elements.attributeDetail.innerHTML, /onerror|<img/, 'External error strings must not enter result HTML.');
assert.equal(diagnostics.attribute.fallback, true);
assert.equal(diagnostics.attribute.error, externalError.message);
assert.equal(statuses.at(-1)[2], 'error');

const html = await readFile(new URL('../magia-circle.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
for (const name of ['magia-circle-diagnostics', 'magia-circle-diagnostic-view', 'magia-circle-results']) {
  assert.ok(scripts.includes(`assets/js/${name}.js`), `${name} must be included by the static page.`);
  assert.ok(scripts.indexOf(`assets/js/${name}.js`) < scripts.indexOf('assets/js/magia-circle-app.js'), `${name} must load before the app.`);
}
assert.ok(scripts.indexOf('assets/js/analysis-diagnostics.js') < scripts.indexOf('assets/js/magia-circle-diagnostics.js'));
console.log('PASS_MAGIA_CIRCLE_RESULTS (shared power, 7 attributes, 4 sigils, fallback, safe error text, script order)');
