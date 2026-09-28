import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const [leftPath, rightPath] = args;
if (!leftPath || !rightPath || args.length !== 2) {
  console.error('Usage: node scripts/compare-image-batches.mjs <left-batch.json> <right-batch.json>');
  process.exit(2);
}

const [left, right] = await Promise.all([leftPath, rightPath].map(async path =>
  JSON.parse(await readFile(resolve(path), 'utf8'))));
const ignoredMetadata = new Set(['_baseline', 'onnxRuntime', 'detectionInferenceMs', 'benchmark']);
const mismatches = [];

function compare(path, a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b)) mismatches.push({ path, left: a, right: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) mismatches.push({ path: `${path}.length`, left: a.length, right: b.length });
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) compare(`${path}[${index}]`, a[index], b[index]);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(key => !ignoredMetadata.has(key)));
    for (const key of keys) compare(`${path}.${key}`, a[key], b[key]);
    return;
  }
  if (a !== b) mismatches.push({ path, left: a, right: b });
}

compare('$', left, right);
console.log(JSON.stringify({
  equal: mismatches.length === 0,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 100),
  ...(mismatches.length > 100 ? { truncated: true } : {}),
}, null, 2));
if (mismatches.length) process.exitCode = 1;
