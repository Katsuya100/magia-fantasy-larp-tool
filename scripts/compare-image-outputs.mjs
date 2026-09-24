import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const [browserPath, batchPath] = args.filter(argument => argument !== '--strict');
if (!browserPath || !batchPath) {
  console.error('Usage: node scripts/compare-image-outputs.mjs [--strict] <browser.json> <batch.json>');
  process.exit(2);
}

const [browser, batch] = await Promise.all([browserPath, batchPath].map(async path => JSON.parse(await readFile(resolve(path), 'utf8'))));
const mismatches = [];
const compare = (path, left, right) => {
  if (typeof left === 'number' && typeof right === 'number') {
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 1e-9) mismatches.push({ path, browser: left, batch: right });
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) mismatches.push({ path: `${path}.length`, browser: left.length, batch: right.length });
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) compare(`${path}[${index}]`, left[index], right[index]);
    return;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) compare(`${path}.${key}`, left[key], right[key]);
    return;
  }
  if (left !== right) mismatches.push({ path, browser: left, batch: right });
};

const normalizedPoints = points => points == null ? [] : Array.isArray(points) ? points : [points];
const normalizeRates = rates => Object.fromEntries((rates || []).map(([key, score]) => [key, score]));
const attributePercentages = rates => Object.fromEntries((rates || []).map(row => Array.isArray(row)
  ? [row[0], row[2]]
  : [row.key, row.percentage]));
const normalizedBrowser = {
  image: { width: browser.image?.canvasWidth ?? browser.image?.naturalWidth, height: browser.image?.canvasHeight ?? browser.image?.naturalHeight },
  spell: {
    text: browser.spell?.text,
    words: browser.spell?.words,
    points: normalizedPoints(browser.spell?.points),
    lines: browser.spell?.lines,
    candidates: browser.spell?.candidates?.map(({ text, x, y, groupId, confidence }) => ({ text, x, y, groupId, confidence })),
    rawCandidates: browser.spell?.rawCandidates?.map(({ line, text, votes }) => ({ line, text, votes })),
  },
  circle: {
    error: browser.circle?.error,
    outer: { x: browser.circle?.outer?.x, y: browser.circle?.outer?.y, radius: browser.circle?.outer?.radius, radii: browser.circle?.outer?.radii, coverage: browser.circle?.outer?.coverage, circleAccuracy: browser.circle?.outer?.circleAccuracy },
    inner: { x: browser.circle?.inner?.x, y: browser.circle?.inner?.y, radius: browser.circle?.inner?.radius, radii: browser.circle?.inner?.radii, coverage: browser.circle?.inner?.coverage, circleAccuracy: browser.circle?.inner?.circleAccuracy },
    circleAccuracy: browser.circle?.circleAccuracy,
    lineStraightness: browser.circle?.lineStraightness,
    ringCoverage: browser.circle?.ringCoverage,
  },
  attribute: {
    top: browser.attribute?.top,
    percentages: attributePercentages(browser.attribute?.rates),
    similarities: browser.attribute?.similarities,
  },
  sigil: { top: browser.sigil?.top, rates: normalizeRates(browser.sigil?.rates), percentages: browser.sigil?.percentages },
  power: {
    total: browser.power?.power,
    qualityAverage: browser.power?.qualityAverage,
    wordCount: browser.power?.normalized?.wordCount,
    normalized: browser.power?.normalized,
    components: Object.fromEntries(Object.entries(browser.power?.scores || {}).map(([key, value]) => [key, value])),
  },
};
const normalizedBatch = {
  image: { width: batch.image?.width, height: batch.image?.height },
  spell: {
    text: batch.spell?.text,
    words: batch.spell?.words,
    points: normalizedPoints(batch.spell?.points),
    lines: batch.spell?.lines,
    candidates: batch.spell?.candidates?.map(({ text, x, y, groupId, confidence }) => ({ text, x, y, groupId, confidence })),
    rawCandidates: batch.spell?.rawCandidates?.map(({ line, text, votes }) => ({ line, text, votes })),
  },
  circle: {
    error: batch.circle?.error,
    outer: { x: batch.circle?.outer?.x, y: batch.circle?.outer?.y, radius: batch.circle?.outer?.radius, radii: batch.circle?.outer?.radii, coverage: batch.circle?.outer?.coverage, circleAccuracy: batch.circle?.outer?.circleAccuracy },
    inner: { x: batch.circle?.inner?.x, y: batch.circle?.inner?.y, radius: batch.circle?.inner?.radius, radii: batch.circle?.inner?.radii, coverage: batch.circle?.inner?.coverage, circleAccuracy: batch.circle?.inner?.circleAccuracy },
    circleAccuracy: batch.circle?.circleAccuracy,
    lineStraightness: batch.circle?.lineStraightness,
    ringCoverage: batch.power?.components?.ringCoverage?.score,
  },
  attribute: {
    top: batch.attribute?.top,
    percentages: Object.fromEntries((batch.attribute?.rows || []).map(row => [row.key, row.percentage])),
    similarities: batch.attribute?.similarities,
  },
  sigil: { top: batch.sigil?.top, rates: batch.sigil?.scores, percentages: batch.sigil?.percentages },
  power: {
    total: batch.power?.total,
    qualityAverage: batch.power?.qualityAverage,
    wordCount: batch.power?.wordCount,
    normalized: batch.power?.normalized,
    components: Object.fromEntries(Object.entries(batch.power?.components || {}).map(([key, value]) => [key, value.score])),
  },
};

compare('$', normalizedBrowser, normalizedBatch);

const toPercent = value => Math.round((value || 0) * 100);
const browserVisible = {
  spell: browser.spell?.text,
  attribute: {
    top: browser.attribute?.top,
    percentages: Object.fromEntries((browser.attribute?.rates || []).map(row => Array.isArray(row)
      ? [row[0], row[2]]
      : [row.key, row.percentage])),
  },
  sigil: { top: browser.sigil?.top, percentages: browser.sigil?.percentages },
  power: {
    total: browser.power?.power,
    wordCount: browser.power?.normalized?.wordCount,
    bars: Object.fromEntries(Object.entries(browser.power?.scores || {}).map(([key, value]) => [key, Math.round(value * 100)])),
    resonance: Object.fromEntries(Object.entries(browser.power?.normalized || {})
      .filter(([key]) => key !== 'wordCount')
      .map(([key, value]) => [key, toPercent(value)])),
  },
};
const batchVisible = {
  spell: batch.spell?.text,
  attribute: {
    top: batch.attribute?.top,
    percentages: Object.fromEntries((batch.attribute?.rows || []).map(row => [row.key, row.percentage])),
  },
  sigil: { top: batch.sigil?.top, percentages: batch.sigil?.percentages },
  power: {
    total: batch.power?.total,
    wordCount: batch.power?.wordCount,
    bars: Object.fromEntries(Object.entries(batch.power?.components || {}).map(([key, value]) => [key, value.barPercent])),
    resonance: Object.fromEntries(Object.entries(batch.power?.components || {}).map(([key, value]) => [key, value.resonancePercent])),
  },
};
const visibleMismatches = [];
const originalMismatches = [...mismatches];
mismatches.length = 0;
compare('$', browserVisible, batchVisible);
visibleMismatches.push(...mismatches);
const diagnosticMismatches = originalMismatches;
console.log(JSON.stringify({
  equal: visibleMismatches.length === 0,
  visibleMismatchCount: visibleMismatches.length,
  visibleMismatches,
  diagnosticsEqual: diagnosticMismatches.length === 0,
  diagnosticMismatchCount: diagnosticMismatches.length,
  ...(strict ? { diagnosticMismatches } : {}),
}, null, 2));
if (visibleMismatches.length || (strict && diagnosticMismatches.length)) process.exitCode = 1;
