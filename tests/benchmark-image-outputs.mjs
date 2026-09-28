import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const image = valueAfter('--image');
const baselinePath = valueAfter('--baseline', 'updated-web-wasm-sample.json');
const iterations = Number(valueAfter('--iterations', '5'));
const outputPath = resolve(valueAfter('--output', 'test-results/onnxruntime/graph-optimization-ab.json'));
const levels = (valueAfter('--levels', 'disabled,basic,extended,all') || '').split(',').filter(Boolean);
const supportedLevels = new Set(['disabled', 'basic', 'extended', 'all']);
if (!image || !Number.isInteger(iterations) || iterations < 1 || levels.some(level => !supportedLevels.has(level))) {
  console.error('Usage: npm run benchmark:image-outputs -- --image <path> [--baseline <json>] [--iterations 5] [--levels disabled,basic,extended,all] [--output <json>]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const testScript = resolve(here, 'test-image-outputs.mjs');
const reference = JSON.parse(await readFile(resolve(baselinePath), 'utf8'));
const ignoredMetadata = new Set(['_baseline', 'onnxRuntime', 'detectionInferenceMs', 'benchmark']);

function compareOutputs(left, right) {
  const mismatches = [];
  const walk = (path, a, b) => {
    if (typeof a === 'number' && typeof b === 'number') {
      if (!Object.is(a, b)) mismatches.push({ path, expected: a, actual: b });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) mismatches.push({ path: `${path}.length`, expected: a.length, actual: b.length });
      for (let index = 0; index < Math.min(a.length, b.length); index += 1) walk(`${path}[${index}]`, a[index], b[index]);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(key => !ignoredMetadata.has(key)));
      for (const key of keys) walk(`${path}.${key}`, a[key], b[key]);
      return;
    }
    if (a !== b) mismatches.push({ path, expected: a, actual: b });
  };
  walk('$', reference, left);
  return mismatches;
}

const summary = {
  image: resolve(image),
  baseline: resolve(baselinePath),
  iterationsPerLevel: iterations,
  levels,
  runtime: { version: '1.30.0', executionProvider: 'wasm', numThreads: 1 },
  results: [],
};
let hadFailures = false;

for (const level of levels) {
  const runs = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const started = performance.now();
    const child = spawnSync(process.execPath, [
      ...process.execArgv,
      testScript,
      '--web-wasm',
      '--graph-optimization-level', level,
      resolve(image),
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const elapsedMs = performance.now() - started;
    let output = null;
    let error = child.error ? `${child.error.name}: ${child.error.message}` : (child.stderr || '').trim() || null;
    if (child.status === 0) {
      try { output = JSON.parse(child.stdout); }
      catch (caught) { error = `Invalid JSON output: ${caught.message}`; }
    }
    const succeeded = child.status === 0 && output !== null;
    if (!succeeded) hadFailures = true;
    const mismatches = output ? compareOutputs(output, reference) : [];
    const outputMatchesBaseline = succeeded && mismatches.length === 0;
    runs.push({
      iteration,
      success: succeeded,
      elapsedMs,
      detectionMs: output?.onnxRuntime?.detectionMs ?? null,
      detectionSessionRunMs: output?.onnxRuntime?.detectionSessionRunMs ?? null,
      outputMatchesBaseline,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 100),
      error: succeeded ? null : error || `Process exited with ${child.status}`,
      output: iteration === 1 && succeeded ? output : undefined,
    });
    console.error(`[benchmark] ${level} ${iteration}/${iterations} ${succeeded ? (outputMatchesBaseline ? 'PASS' : 'OUTPUT-DIFF') : 'FAIL'} batch=${elapsedMs.toFixed(0)}ms run=${Number.isFinite(output?.onnxRuntime?.detectionSessionRunMs) ? `${output.onnxRuntime.detectionSessionRunMs.toFixed(1)}ms` : 'n/a'}`);
  }

  const successes = runs.filter(run => run.success);
  const durations = successes.map(run => run.detectionMs).filter(Number.isFinite);
  const inferenceDurations = successes.map(run => run.detectionSessionRunMs).filter(Number.isFinite);
  const elapsedValues = successes.map(run => run.elapsedMs);
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  summary.results.push({
    graphOptimizationLevel: level,
    successCount: successes.length,
    failureCount: runs.length - successes.length,
    outputMatchCount: runs.filter(run => run.success && run.outputMatchesBaseline).length,
    outputMismatchCount: runs.filter(run => run.success && !run.outputMatchesBaseline).length,
    averageDetectionMs: average(durations),
    minDetectionMs: durations.length ? Math.min(...durations) : null,
    maxDetectionMs: durations.length ? Math.max(...durations) : null,
    averageSessionRunMs: average(inferenceDurations),
    minSessionRunMs: inferenceDurations.length ? Math.min(...inferenceDurations) : null,
    maxSessionRunMs: inferenceDurations.length ? Math.max(...inferenceDurations) : null,
    averageBatchMs: average(elapsedValues),
    minBatchMs: elapsedValues.length ? Math.min(...elapsedValues) : null,
    maxBatchMs: elapsedValues.length ? Math.max(...elapsedValues) : null,
    runs,
  });
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: outputPath,
  image: summary.image,
  baseline: summary.baseline,
  iterationsPerLevel: summary.iterationsPerLevel,
  runtime: summary.runtime,
  results: summary.results.map(({ runs, ...result }) => result),
}, null, 2));
if (hadFailures || summary.results.some(result => result.outputMismatchCount > 0)) process.exitCode = 1;
